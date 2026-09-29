from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
import httpx
from sqlalchemy.orm import sessionmaker

from backend.app.db import Base
from backend.app.models import Article, RiskEvent, Site, Supplier
from backend.app.risk import assess, exact_name_match, normalize_url
from collector.worker import claim_job, ingest, parse_gdelt, plan_searches, reclaim_stale_jobs, source_label, supplier_names, validate_outbound
from collector import worker


def test_ambiguous_name_rejected_and_severity_conservative():
    assert exact_name_match("Acme2 factory fire", ["Acme"]) is None
    assert exact_name_match("Acme factory fire", ["Acme"]) == "Acme"
    assert assess("Acme factory fire") == ("生产中断", "orange")
    assert assess("Acme expansion") is None
    parsed = list(parse_gdelt({"articles": [{"title": "Acme fire", "url": "https://news.example/a",
                                               "seendate": "20260929T120000Z"}]}))
    assert parsed[0]["published_at"].hour == 12
    assert normalize_url("https://news.example/story?id=1&utm_source=mail") == "https://news.example/story?id=1"
    assert normalize_url("https://news.example/story?id=1") != normalize_url("https://news.example/story?id=2")


def test_aliases_are_split_deduplicated_and_budgeted():
    supplier = Supplier(name="华光封装", aliases="Global Materials, GM，global materials | GM")
    assert supplier_names(supplier) == ["华光封装", "Global Materials", "GM"]
    assert plan_searches([supplier], 6, 2)[0][0][1] == supplier_names(supplier)
    partial, skipped = plan_searches([supplier], 4, 2)
    assert partial[0][1] == ["华光封装", "Global Materials"]
    assert skipped == 2
    supplier.search_cursor = 2
    assert plan_searches([supplier], 4, 2)[0][0][1] == ["GM", "华光封装"]


def test_ingestion_is_idempotent_and_site_scope_requires_site_name():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        supplier = Supplier(name="Acme Materials", aliases="Acme")
        db.add(supplier)
        db.flush()
        db.add(Site(supplier_id=supplier.id, name="Penang Plant", city="Penang"))
        db.commit()
        record = {"title": "Acme Materials fire in Penang", "url": "https://news.example/a?utm_source=x",
                  "summary": "Unverified media mention", "source": "Example", "source_type": "rss"}
        assert ingest(db, record, supplier) == (1, 1)
        db.commit()
        assert ingest(db, record, supplier) == (0, 0)
        assert db.scalar(select(RiskEvent)).site_id is None
        record2 = {**record, "url": "https://news.example/b", "title": "Acme Materials Penang Plant fire"}
        assert ingest(db, record2, supplier) == (1, 1)
        db.commit()
        assert db.scalar(select(Article).where(Article.url == "https://news.example/b")).title == record2["title"]
        assert len(db.scalars(select(RiskEvent)).all()) == 2
        assert db.scalars(select(RiskEvent).order_by(RiskEvent.id.desc())).first().site_id is not None


def test_unapproved_and_private_endpoints_are_blocked_without_fetching():
    for url in ("https://127.0.0.1/x", "http://news.example/a", "https://evil.example/a",
                "https://user:pass@news.example/a"):
        try:
            validate_outbound(url, {"news.example"}, proxied=True)
        except ValueError:
            pass
        else:
            raise AssertionError(url)


def test_builtin_endpoint_private_dns_exception_is_exact(monkeypatch):
    monkeypatch.setattr(worker.socket, "getaddrinfo", lambda *_args, **_kwargs: [(None, None, None, None, ("10.0.0.5", 443))])
    allow = {"api.gdeltproject.org", "news.google.com", "feed.example"}
    validate_outbound(worker.GDELT_URL, allow)
    validate_outbound(worker.GOOGLE_NEWS_URL, allow)
    for url in ("https://feed.example/rss", "https://news.google.com/other"):
        try:
            validate_outbound(url, allow)
        except ValueError as exc:
            assert "non-public" in str(exc)
        else:
            raise AssertionError(url)


def test_configured_outbound_allowlist_is_not_extended(monkeypatch):
    monkeypatch.setenv("OUTBOUND_ALLOWLIST", "feed.example")
    assert worker.config()["allow"] == {"feed.example"}


def test_running_job_recovered_after_lease_and_bounded_attempts():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    now = worker.utcnow()
    with Session(engine) as db:
        db.add(worker.ScanJob(status="running", started_at=now - worker.timedelta(minutes=10),
                              lease_updated_at=now - worker.timedelta(minutes=10), attempts=1))
        db.add(worker.ScanJob(status="running", started_at=now - worker.timedelta(minutes=10),
                              lease_updated_at=now - worker.timedelta(minutes=10), attempts=3))
        db.add(worker.ScanJob(status="running", started_at=now, lease_updated_at=now, attempts=1))
        db.commit()
        assert reclaim_stale_jobs(db, now=now, lease_seconds=180) == 2
        assert [j.status for j in db.scalars(select(worker.ScanJob).order_by(worker.ScanJob.id))] == ["queued", "failed", "running"]


def test_job_claim_is_single_winner():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(worker.ScanJob(status="queued"))
        db.commit()
    with Session(engine) as first, Session(engine) as second:
        assert claim_job(first, 1).attempts == 1
        assert claim_job(second, 1) is None


def test_gdelt_rate_limit_keeps_google_rss_running(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(Supplier(name="Real Co"))
        db.add(worker.ScanJob(status="queued"))
        db.commit()
    monkeypatch.setattr(worker, "SessionLocal", sessionmaker(bind=engine, expire_on_commit=False))
    monkeypatch.setattr(worker, "initialize_schema", lambda: None)
    monkeypatch.setattr(worker, "config", lambda: {"feeds": [], "allow": {"api.gdeltproject.org", "news.google.com"},
                                                    "proxy": None, "gdelt": True, "google_news": True,
                                                    "max_records": 10, "request_budget": 2, "request_delay": 0})
    xml = b'<rss><channel><title>Google News</title><item><title>Real Co factory fire</title><link>https://news.example/one</link></item></channel></rss>'

    def fake_fetch(_client, url, _allow, **_kwargs):
        if url == worker.GDELT_URL:
            response = httpx.Response(429, request=httpx.Request("GET", url))
            raise httpx.HTTPStatusError("rate limited", request=response.request, response=response)
        return httpx.Response(200, content=xml, request=httpx.Request("GET", url))

    monkeypatch.setattr(worker, "fetch", fake_fetch)
    worker.run_job(1)
    with Session(engine) as db:
        job = db.get(worker.ScanJob, 1)
        assert job.status == "partial"
        assert job.events_created == 1
        assert db.scalar(select(worker.SourceStatus).where(worker.SourceStatus.name == "GDELT")).status == "rate_limited"
        assert db.scalar(select(worker.SourceStatus).where(worker.SourceStatus.name == "Google News RSS")).status == "ok"
        assert db.scalar(select(Supplier)).last_scan_coverage_complete is False


def test_english_alias_is_queried_and_matched(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(Supplier(name="华光封装", aliases="Global Materials，GM | global materials"))
        db.add(worker.ScanJob(status="queued"))
        db.commit()
    monkeypatch.setattr(worker, "SessionLocal", sessionmaker(bind=engine, expire_on_commit=False))
    monkeypatch.setattr(worker, "initialize_schema", lambda: None)
    monkeypatch.setattr(worker, "config", lambda: {"feeds": [], "allow": {"api.gdeltproject.org", "news.google.com"},
                                                    "proxy": None, "gdelt": True, "google_news": True,
                                                    "max_records": 10, "request_budget": 6, "request_delay": 0})
    searched = []
    empty_rss = b"<rss><channel><title>Google News</title></channel></rss>"

    def fake_fetch(_client, url, _allow, *, params=None, **_kwargs):
        searched.append((url, params.get("query") or params.get("q")))
        request = httpx.Request("GET", url)
        if url == worker.GDELT_URL:
            data = {"articles": [{"title": "Global Materials factory fire", "url": "https://news.example/alias-fire"}]}
            if '"Global Materials"' not in params["query"]:
                data = {"articles": []}
            return httpx.Response(200, json=data, request=request)
        return httpx.Response(200, content=empty_rss, request=request)

    monkeypatch.setattr(worker, "fetch", fake_fetch)
    worker.run_job(1)
    assert len(searched) == 6
    assert sum('"Global Materials"' in query for _url, query in searched) == 2
    with Session(engine) as db:
        assert db.scalar(select(worker.ScanJob)).events_created == 1
        assert db.scalar(select(Supplier)).last_scan_coverage_complete is True
        assert "Global Materials" in db.scalar(select(RiskEvent)).matching_reason


def test_feed_status_never_persists_query_token(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    url = "https://feeds.example/private-path-token/news?token=private-secret"
    with Session(engine) as db:
        db.add(worker.ScanJob(status="queued"))
        db.commit()
    monkeypatch.setattr(worker, "SessionLocal", sessionmaker(bind=engine, expire_on_commit=False))
    monkeypatch.setattr(worker, "initialize_schema", lambda: None)
    monkeypatch.setattr(worker, "config", lambda: {"feeds": [url], "allow": {"feeds.example"},
                                                    "proxy": None, "gdelt": False, "google_news": False,
                                                    "max_records": 10, "request_budget": 1, "request_delay": 0})

    def fail_fetch(_client, feed_url, _allow, **_kwargs):
        request = httpx.Request("GET", feed_url)
        response = httpx.Response(403, request=request)
        raise httpx.HTTPStatusError(f"Denied at {feed_url}", request=request, response=response)

    monkeypatch.setattr(worker, "fetch", fail_fetch)
    worker.run_job(1)
    with Session(engine) as db:
        status = db.scalar(select(worker.SourceStatus))
        job = db.scalar(select(worker.ScanJob))
        assert "private-secret" not in status.name + status.message + job.errors
        assert "private-path-token" not in status.name + status.message + job.errors
        assert status.name == source_label(url)
        assert status.name.startswith("feeds.example [")
        assert status.message == "HTTP 403"
