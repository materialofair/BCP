"""Single-process scheduled collector. Run with ``python -m collector.worker``."""
import ipaddress
import hashlib
import logging
import os
import re
import socket
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import feedparser
import httpx
from sqlalchemy import func, select, update

from backend.app.db import SessionLocal, initialize_schema
from backend.app.models import Article, RiskEvent, ScanJob, SourceStatus, Supplier, Site, utcnow
from backend.app.risk import assess, exact_name_match, normalize_url

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)
GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
GOOGLE_NEWS_URL = "https://news.google.com/rss/search"


def supplier_names(supplier: Supplier) -> list[str]:
    """Canonical name and comma/Chinese-comma/pipe aliases, in stable unique order."""
    names = [supplier.name, *re.split(r"[,，|]", supplier.aliases or "")]
    unique = {}
    for raw in names:
        name = raw.strip()
        if name:
            unique.setdefault(name.casefold(), name)
    return list(unique.values())


def source_label(url: str) -> str:
    """A feed identifier safe for logs and the source-status API."""
    parsed = urlsplit(url)
    return f"{parsed.hostname or 'unknown'} [{hashlib.sha256(url.encode()).hexdigest()[:8]}]"


def safe_error(exc: Exception) -> str:
    """Keep request URLs, proxy credentials and RSS tokens out of persisted errors."""
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    return type(exc).__name__


def plan_searches(suppliers: list[Supplier], budget: int, source_count: int):
    """Allocate complete name sets first; rotate oversized sets across runs."""
    if not source_count or budget < source_count:
        return [], sum(len(supplier_names(s)) * source_count for s in suppliers)
    remaining = budget
    plan = []
    total = sum(len(supplier_names(s)) * source_count for s in suppliers)
    for supplier in suppliers:
        names = supplier_names(supplier)
        cost = len(names) * source_count
        if cost <= remaining:
            selected = names
        elif cost > budget and remaining >= source_count:
            count = min(len(names), remaining // source_count)
            start = (supplier.search_cursor or 0) % len(names)
            selected = [names[(start + index) % len(names)] for index in range(count)]
        else:
            continue
        plan.append((supplier, selected))
        remaining -= len(selected) * source_count
    return plan, total - (budget - remaining)


def config():
    feeds = [u.strip() for u in os.getenv("RSS_FEEDS", "").split(",") if u.strip()]
    allow = {h.strip().lower() for h in os.getenv("OUTBOUND_ALLOWLIST", "api.gdeltproject.org,news.google.com").split(",") if h.strip()}
    return {"feeds": feeds, "allow": allow,
            "proxy": os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY") or None,
            "gdelt": os.getenv("GDELT_ENABLED", "true").lower() in ("1", "true", "yes"),
            "google_news": os.getenv("GOOGLE_NEWS_ENABLED", "true").lower() in ("1", "true", "yes"),
            "max_records": max(1, min(int(os.getenv("GDELT_MAX_RECORDS", "20")), 100)),
            "request_budget": max(1, int(os.getenv("SCAN_REQUEST_BUDGET", "100"))),
            "request_delay": max(0, float(os.getenv("SCAN_REQUEST_DELAY_SECONDS", "1")))}


def validate_outbound(url: str, allow: set[str], *, proxied: bool = False):
    p = urlsplit(url)
    if p.scheme != "https" or not p.hostname or p.username or p.password or p.port not in (None, 443):
        raise ValueError("Only approved HTTPS endpoints are allowed")
    hostname = p.hostname.lower().rstrip(".")
    if hostname not in allow:
        raise ValueError("Outbound host is not in OUTBOUND_ALLOWLIST")
    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        ip = None
    if ip is not None:
        raise ValueError("IP literal endpoints are not allowed")
    # These two fixed built-in search endpoints are reached through TLS even when
    # local DNS reports a private address for a corporate egress gateway.
    if not proxied and url not in (GDELT_URL, GOOGLE_NEWS_URL):
        addresses = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ValueError("Endpoint resolves to a non-public address")


def fetch(client: httpx.Client, url: str, allow: set[str], *, proxied: bool, params=None):
    validate_outbound(url, allow, proxied=proxied)
    for attempt in range(3):
        try:
            response = client.get(url, params=params, follow_redirects=False, timeout=20)
            if 300 <= response.status_code < 400:
                raise ValueError("Redirect blocked; add the final source URL explicitly")
            if response.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(min(4, 2 ** attempt))
                continue
            response.raise_for_status()
            if len(response.content) > 4_000_000:
                raise ValueError("Source response exceeds 4 MB")
            return response
        except (httpx.TimeoutException, httpx.NetworkError):
            if attempt == 2:
                raise
            time.sleep(min(4, 2 ** attempt))
    raise RuntimeError("Unreachable retry state")


def parse_gdelt(data: dict):
    for item in data.get("articles", []):
        title, url = item.get("title", ""), item.get("url", "")
        if not title or not url:
            continue
        published = None
        raw_date = item.get("seendate", "")
        try:
            published = datetime.strptime(raw_date[:15], "%Y%m%dT%H%M%S")
        except ValueError:
            pass
        yield {"title": title, "url": url, "summary": "", "source": item.get("domain") or "GDELT",
               "source_type": "gdelt", "published_at": published}


def parse_feed(raw: bytes, url: str):
    feed = feedparser.parse(raw)
    if feed.bozo and not feed.entries:
        raise ValueError("Invalid RSS/Atom response")
    source = feed.feed.get("title") or urlsplit(url).hostname
    for entry in feed.entries:
        published = None
        if entry.get("published_parsed"):
            published = datetime.fromtimestamp(time.mktime(entry.published_parsed), timezone.utc).replace(tzinfo=None)
        yield {"title": entry.get("title", ""), "url": entry.get("link", ""),
               "summary": re.sub(r"<[^>]*>", " ", entry.get("summary", ""))[:1000],
               "source": source, "source_type": "rss", "published_at": published}


def source_state(db, name, status, message=""):
    state = db.scalar(select(SourceStatus).where(SourceStatus.name == name))
    if not state:
        state = SourceStatus(name=name)
        db.add(state)
    state.status = status
    state.message = message[:500]
    state.checked_at = utcnow()
    if status == "ok":
        state.last_success_at = state.checked_at
    db.commit()


def reclaim_stale_jobs(db, *, now=None, lease_seconds=180):
    """Resume interrupted jobs after their lease expires; stop after three attempts."""
    now = now or utcnow()
    reclaimed = 0
    for job in db.scalars(select(ScanJob).where(ScanJob.status == "running")):
        last_seen = job.lease_updated_at or job.started_at or job.created_at
        if last_seen and last_seen > now - timedelta(seconds=lease_seconds):
            continue
        message = "采集 Worker 中断，任务已重新排队" if (job.attempts or 0) < 3 else "采集 Worker 多次中断，任务失败"
        job.errors = (job.errors + "\n" + message).strip()[:4000]
        job.status = "queued" if (job.attempts or 0) < 3 else "failed"
        if job.status == "failed":
            job.finished_at = now
        reclaimed += 1
    if reclaimed:
        db.commit()
    return reclaimed


def touch_lease(db, job):
    job.lease_updated_at = utcnow()
    db.commit()


def claim_job(db, job_id: int):
    """Claim once across API/worker processes; only one worker may start a queued job."""
    now = utcnow()
    result = db.execute(update(ScanJob).where(ScanJob.id == job_id, ScanJob.status == "queued")
                        .values(status="running", started_at=now, lease_updated_at=now,
                                attempts=func.coalesce(ScanJob.attempts, 0) + 1))
    if result.rowcount != 1:
        db.rollback()
        return None
    db.commit()
    return db.get(ScanJob, job_id)


def ingest(db, record: dict, supplier: Supplier):
    """Return (new article, new event); only exact supplier names/aliases qualify."""
    matched = exact_name_match(record["title"] + " " + record.get("summary", ""),
                               supplier_names(supplier))
    if not matched:
        return 0, 0
    assessment = assess(record["title"] + " " + record.get("summary", ""))
    if not assessment:
        return 0, 0
    try:
        url = normalize_url(record["url"])
    except ValueError:
        return 0, 0
    article = db.scalar(select(Article).where(Article.url == url))
    created_article = 0
    if not article:
        article = Article(url=url, title=record["title"][:2000], summary=record.get("summary", "")[:3000],
                          source=record.get("source", "")[:160], source_type=record.get("source_type", "search"),
                          published_at=record.get("published_at"), content_available=False)
        db.add(article)
        db.flush()
        created_article = 1
    if db.scalar(select(RiskEvent.id).where(RiskEvent.supplier_id == supplier.id, RiskEvent.article_id == article.id)):
        return created_article, 0
    category, level = assessment
    # Site-level impact requires a site name in the report; a city alone is not enough.
    site = next((s for s in supplier.sites if exact_name_match(record["title"], [s.name])), None)
    event = RiskEvent(supplier_id=supplier.id, site_id=site.id if site else None, article_id=article.id,
                      title=record["title"][:2000], summary=(record.get("summary") or
                      "仅获取到标题，尚未核实正文及对供货的影响。")[:3000], category=category,
                      risk_level=level, auto_risk_level=level, verification="unverified",
                      matching_reason=f"标题或摘要包含供应商名称：{matched}；" +
                      (f"标题包含地点名称：{site.name}" if site else "未确认具体供货地点"))
    db.add(event)
    return created_article, 1


def run_job(job_id: int):
    cfg = config()
    initialize_schema()
    with SessionLocal() as db:
        job = claim_job(db, job_id)
        if not job:
            return
        previous_errors = job.errors
        suppliers = db.scalars(select(Supplier).where(Supplier.monitored.is_(True), Supplier.is_demo.is_(False))
                               .order_by(Supplier.last_scanned_at.asc().nulls_first(), Supplier.id)).all()
        for supplier in suppliers:
            supplier.sites  # load before fetches
        errors = []
        any_success = False
        requests_used = 0
        proxy = cfg["proxy"]
        required_searches = [key for key in ("gdelt", "google_news") if cfg[key]]
        for enabled_key, host, name in (("gdelt", "api.gdeltproject.org", "GDELT"),
                                        ("google_news", "news.google.com", "Google News RSS")):
            if cfg[enabled_key] and host not in cfg["allow"]:
                cfg[enabled_key] = False
                errors.append(f"{name}: 出站主机未列入 OUTBOUND_ALLOWLIST")
                source_state(db, name, "blocked", "出站主机未列入 OUTBOUND_ALLOWLIST")
        enabled_searches = int(cfg["gdelt"]) + int(cfg["google_news"])
        feed_budget = min(len(cfg["feeds"]), cfg["request_budget"])
        search_plan, budget_skipped = plan_searches(suppliers, cfg["request_budget"] - feed_budget, enabled_searches)
        budget_skipped += max(0, len(cfg["feeds"]) - feed_budget)
        attempted = set()
        outcomes = {supplier.id: set() for supplier, _names in search_plan}
        feed_success = set()

        def scan_named_source(key, label, endpoint):
            nonlocal any_success, requests_used
            if not cfg[key]:
                return
            for supplier, names in search_plan:
                for name in names:
                    attempted.add(supplier.id)
                    safe_name = name.replace('"', " ")
                    params = ({"query": f'"{safe_name}" (shutdown OR fire OR shortage OR flood OR strike OR 停产 OR 火灾 OR 短缺)',
                               "mode": "artlist", "format": "json", "maxrecords": cfg["max_records"], "sort": "datedesc"}
                              if key == "gdelt" else
                              {"q": f'"{safe_name}" (fire OR shutdown OR shortage OR flood OR strike OR 停产 OR 火灾 OR 短缺)',
                               "hl": "en-US", "gl": "US", "ceid": "US:en"})
                    try:
                        requests_used += 1
                        response = fetch(client, endpoint, cfg["allow"], proxied=bool(proxy), params=params)
                        records = parse_gdelt(response.json()) if key == "gdelt" else parse_feed(response.content, str(response.request.url))
                        for record in records:
                            a, e = ingest(db, record, supplier)
                            job.articles_found += a
                            job.events_created += e
                        outcomes[supplier.id].add((key, name.casefold()))
                        supplier.last_scanned_at = utcnow()
                        db.commit()
                        any_success = True
                        source_state(db, label, "ok")
                    except Exception as exc:
                        log.warning("%s scan failed for supplier %s: %s", label, supplier.id, safe_error(exc))
                        errors.append(f"{label} / {supplier.name} / {name}: {safe_error(exc)}")
                        rate_limited = isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429
                        source_state(db, label, "rate_limited" if rate_limited else "failed", safe_error(exc))
                        if rate_limited:
                            touch_lease(db, job)
                            return
                    touch_lease(db, job)
                    if cfg["request_delay"]:
                        time.sleep(cfg["request_delay"])

        try:
            with httpx.Client(proxy=proxy, trust_env=False, headers={"User-Agent": "BCP-RiskScanner/0.1"}) as client:
                scan_named_source("gdelt", "GDELT", GDELT_URL)
                scan_named_source("google_news", "Google News RSS", GOOGLE_NEWS_URL)
                for feed_url in cfg["feeds"]:
                    if requests_used >= cfg["request_budget"]:
                        break
                    try:
                        requests_used += 1
                        response = fetch(client, feed_url, cfg["allow"], proxied=bool(proxy))
                        for record in parse_feed(response.content, feed_url):
                            for supplier in suppliers:
                                a, e = ingest(db, record, supplier)
                                job.articles_found += a
                                job.events_created += e
                        # RSS coverage only establishes source reachability, not a supplier-specific negative result.
                        db.commit()
                        any_success = True
                        feed_success.add(feed_url)
                        source_state(db, source_label(feed_url), "ok")
                    except Exception as exc:
                        log.warning("RSS scan failed at %s: %s", source_label(feed_url), safe_error(exc))
                        errors.append(f"RSS / {source_label(feed_url)}: {safe_error(exc)}")
                        source_state(db, source_label(feed_url), "failed", safe_error(exc))
                    touch_lease(db, job)
                    if cfg["request_delay"]:
                        time.sleep(cfg["request_delay"])
        except Exception as exc:
            errors.append(f"Collector: {safe_error(exc)}")
        for supplier, names in search_plan:
            if supplier.id not in attempted:
                continue
            supplier.last_scan_job_id = job.id
            all_names = supplier_names(supplier)
            expected = {(source, name.casefold()) for source in required_searches for name in all_names}
            supplier.last_scan_coverage_complete = (len(names) == len(all_names)
                                                    and bool(expected)
                                                    and expected.issubset(outcomes[supplier.id])
                                                    and set(cfg["feeds"]).issubset(feed_success))
            if len(names) < len(all_names) and outcomes[supplier.id]:
                supplier.search_cursor = ((supplier.search_cursor or 0) + len(names)) % len(all_names)
        if budget_skipped > 0:
            errors.append(f"本轮请求预算为 {cfg['request_budget']}，{budget_skipped} 个企业/来源请求留待下轮扫描")
        job.errors = "\n".join(part for part in [previous_errors, *errors] if part)[:4000]
        job.status = "partial" if any_success and errors else "completed" if any_success else "failed" if errors else "no_sources"
        job.finished_at = utcnow()
        db.commit()


def loop():
    initialize_schema()
    interval = max(1, float(os.getenv("SCAN_INTERVAL_HOURS", "6")))
    log.info("Collector started; scan interval %s hours", interval)
    while True:
        with SessionLocal() as db:
            reclaim_stale_jobs(db, lease_seconds=max(90, int(os.getenv("SCAN_JOB_LEASE_SECONDS", "180"))))
            queued = db.scalar(select(ScanJob).where(ScanJob.status == "queued").order_by(ScanJob.created_at).limit(1))
            if queued:
                job_id = queued.id
            else:
                last = db.scalar(select(ScanJob).where(ScanJob.trigger == "scheduled")
                                 .order_by(ScanJob.created_at.desc()).limit(1))
                if not last or last.created_at < utcnow() - timedelta(hours=interval):
                    job = ScanJob(trigger="scheduled", status="queued")
                    db.add(job)
                    db.commit()
                    job_id = job.id
                else:
                    job_id = None
        if job_id:
            run_job(job_id)
        else:
            time.sleep(15)


if __name__ == "__main__":
    loop()
