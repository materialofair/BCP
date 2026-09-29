"""Deliberately conservative keyword assessment for unverified external leads."""
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

HIGH = ("shutdown", "production halted", "plant closure", "factory fire", "停产", "工厂火灾", "断供", "制裁")
MEDIUM = ("fire", "strike", "bankruptcy", "flood", "earthquake", "shortage", "recall", "火灾", "罢工", "破产", "洪水", "地震", "短缺", "召回", "停电")
LOW = ("delay", "disruption", "investigation", "出口限制", "延误", "中断", "调查", "涨价")
CATEGORY_TERMS = {
    "生产中断": ("shutdown", "halted", "closure", "fire", "停产", "火灾", "停电"),
    "自然灾害": ("flood", "earthquake", "typhoon", "洪水", "地震", "台风"),
    "贸易政策": ("sanction", "export ban", "出口限制", "制裁"),
    "经营财务": ("bankruptcy", "insolvency", "破产", "违约"),
    "质量问题": ("recall", "contamination", "召回", "污染"),
    "物流中断": ("delay", "port closure", "shipping", "物流", "延误"),
    "供应能力": ("shortage", "capacity", "短缺", "产能", "断供"),
}


def normalize_url(url: str) -> str:
    p = urlsplit(url.strip())
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ValueError("Invalid article URL")
    host = p.hostname.lower()
    port = f":{p.port}" if p.port else ""
    path = p.path.rstrip("/") or "/"
    tracking = {"fbclid", "gclid", "yclid", "igshid", "mc_cid", "mc_eid"}
    params = sorted((key, value) for key, value in parse_qsl(p.query, keep_blank_values=True)
                    if not key.lower().startswith("utm_") and key.lower() not in tracking)
    return urlunsplit((p.scheme.lower(), host + port, path, urlencode(params), ""))


def exact_name_match(text: str, names: list[str]) -> str | None:
    for name in sorted((n.strip() for n in names if n.strip()), key=len, reverse=True):
        if re.search(r"[\u4e00-\u9fff]", name):
            if name in text:
                return name
        elif re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", text, re.I):
            return name
    return None


def assess(text: str, *, title_only: bool = True) -> tuple[str, str] | None:
    lowered = text.lower()
    if not any(term in lowered for term in HIGH + MEDIUM + LOW):
        return None
    category = next((cat for cat, terms in CATEGORY_TERMS.items() if any(t in lowered for t in terms)), "其他")
    # A title or search snippet cannot establish an actual supplier outage.
    level = "orange" if any(t in lowered for t in HIGH + MEDIUM) else "yellow"
    if not title_only and any(t in lowered for t in HIGH):
        level = "orange"  # Human review is required for confirmed red.
    return category, level
