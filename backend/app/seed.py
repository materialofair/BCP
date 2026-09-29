"""Fictional records for first-run UI inspection; never presented as real reports."""
from sqlalchemy import delete, select

from .models import Article, MaterialCategory, Review, RiskEvent, Site, Supplier

MATERIALS = ["封装基板", "引线框架", "键合线", "塑封料", "底填胶", "芯片粘接材料", "焊球", "助焊剂"]
DEMO = [
    ("星澜封装材料（演示）", "苏州示例工厂", "苏州", "中国", 31.30, 120.58, "封装基板、底填胶", "green"),
    ("Northstar Packaging Materials (Demo)", "Penang sample plant", "Penang", "Malaysia", 5.42, 100.33, "塑封料、芯片粘接材料", "yellow"),
    ("Aurora Bonding (Demo)", "Tokyo sample plant", "Tokyo", "Japan", 35.68, 139.69, "键合线、焊球", "orange"),
    ("蓝桥电子材料（演示）", "新加坡示例仓库", "Singapore", "Singapore", 1.35, 103.82, "引线框架、助焊剂", "green"),
    ("Helios Substrates (Demo)", "Dresden sample plant", "Dresden", "Germany", 51.05, 13.74, "封装基板", "yellow"),
    ("Pacific Encapsulation (Demo)", "Phoenix sample plant", "Phoenix", "United States", 33.45, -112.07, "塑封料", "green"),
]


def seed_demo(db):
    if db.query(Supplier).first():
        return
    for material in MATERIALS:
        db.add(MaterialCategory(name=material))
    for supplier_name, site_name, city, country, lat, lon, materials, risk in DEMO:
        supplier = Supplier(name=supplier_name, is_demo=True)
        db.add(supplier)
        db.flush()
        site = Site(supplier_id=supplier.id, name=site_name, city=city, country=country,
                    latitude=lat, longitude=lon, materials=materials)
        db.add(site)
        db.flush()
        if risk != "green":
            article = Article(source="演示数据", source_type="demo", title=f"【演示】{supplier_name} 供应风险线索",
                              url=f"https://example.invalid/demo/{supplier.id}",
                              summary="虚构演示记录，仅用于展示页面交互，不代表真实企业新闻。")
            db.add(article)
            db.flush()
            db.add(RiskEvent(supplier_id=supplier.id, site_id=site.id, article_id=article.id,
                             title=article.title, summary=article.summary, category="供应能力",
                             risk_level=risk, auto_risk_level=risk, verification="demo", matching_reason="虚构演示地点"))
    db.commit()


def remove_demo_data(db):
    """On first real entry, remove fictional records so they cannot appear as live news."""
    demo_ids = select(Supplier.id).where(Supplier.is_demo.is_(True))
    event_ids = select(RiskEvent.id).where(RiskEvent.supplier_id.in_(demo_ids))
    db.execute(delete(Review).where(Review.event_id.in_(event_ids)))
    db.execute(delete(RiskEvent).where(RiskEvent.supplier_id.in_(demo_ids)))
    db.execute(delete(Site).where(Site.supplier_id.in_(demo_ids)))
    db.execute(delete(Article).where(Article.source_type == "demo"))
    db.execute(delete(Supplier).where(Supplier.is_demo.is_(True)))
