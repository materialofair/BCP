from fastapi.testclient import TestClient
import base64
import io
import json
import secrets
from openpyxl import load_workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.db import Base, get_db
from backend.app.main import app
from backend.app.models import Article, AuditLog, RiskEvent, ScanJob, Site, Supplier, utcnow
from backend.app.auth import password_hash
from backend.app.seed import seed_demo


def test_supplier_csv_and_human_review_persist():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        with TestClient(app) as client:
            csv_data = "supplier_name,site_name,city,country,latitude,longitude,materials\nExample One,Plant A,Suzhou,China,31.3,120.6,封装基板\n"
            response = client.post("/api/suppliers/import", files={"file": ("suppliers.csv", csv_data.encode())})
            assert response.status_code == 200
            assert response.json()["created"] == 1
            assert client.get("/api/sites").json()[0]["risk_level"] == "gray"
            response = client.post("/api/suppliers/import", files={"file": ("suppliers.csv", csv_data.encode())})
            assert response.json()["created"] == 0
            assert len(client.get("/api/sites").json()) == 1
            with Session(engine) as db:
                supplier = db.scalar(select(Supplier))
                site = db.scalar(select(Site))
                article = Article(source="Test", title="Example One Plant A fire", url="https://example.com/a")
                db.add(article)
                db.flush()
                db.add(RiskEvent(supplier_id=supplier.id, site_id=site.id, article_id=article.id,
                                 title=article.title, summary="Potential fire; unverified", category="生产中断",
                                 risk_level="orange", verification="unverified"))
                db.commit()
            assert client.get("/api/sites").json()[0]["risk_level"] == "orange"
            response = client.post("/api/events/1/reviews", json={"status": "false_positive", "reason": "Wrong company"})
            assert response.status_code == 200
            assert client.get("/api/sites").json()[0]["risk_level"] == "gray"
            assert client.get("/api/events/1").json()["reviews"][0]["reason"] == "Wrong company"
            response = client.post("/api/events/1/reviews", json={"status": "confirmed", "reason": "Official plant notice", "risk_level": "red"})
            assert response.status_code == 200
            assert response.json()["risk_level"] == "red"
            assert response.json()["auto_risk_level"] == "orange"
            assert client.get("/api/sites").json()[0]["risk_level"] == "red"
    finally:
        app.dependency_overrides.clear()


def test_roles_protect_mutations(tmp_path, monkeypatch):
    users = {}
    for name, role in (("viewer", "reader"), ("checker", "analyst"), ("owner", "admin")):
        salt = secrets.token_hex(16)
        users[name] = {"role": role, "salt": salt, "hash": password_hash("long-test-password", salt)}
    path = tmp_path / "users.json"
    path.write_text(json.dumps(users))
    monkeypatch.setenv("BCP_AUTH_USERS_FILE", str(path))

    def token(username):
        value = base64.b64encode(f"{username}:long-test-password".encode()).decode()
        return {"Authorization": f"Basic {value}"}

    with TestClient(app) as client:
        assert client.get("/api/dashboard").status_code == 401
        assert client.get("/api/dashboard", headers=token("viewer")).status_code == 200
        assert client.post("/api/scan-jobs", headers=token("viewer")).status_code == 403
        assert client.post("/api/scan-jobs", headers=token("checker")).status_code == 202
        assert client.post("/api/suppliers", json={"name": "Test"}, headers=token("checker")).status_code == 403


def test_real_supplier_import_removes_fictional_news():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        seed_demo(db)

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        with TestClient(app) as client:
            assert client.get("/api/dashboard").json()["demo_mode"] is True
            response = client.post("/api/suppliers", json={"name": "Real Supplier"})
            assert response.status_code == 201
            assert client.get("/api/dashboard").json()["demo_mode"] is False
            assert client.get("/api/news").json() == []
            assert [s["name"] for s in client.get("/api/suppliers").json()] == ["Real Supplier"]
    finally:
        app.dependency_overrides.clear()


def test_xlsx_import():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        with TestClient(app) as client:
            template = client.get("/api/supplier-import-template.xlsx")
            assert template.status_code == 200
            workbook = load_workbook(io.BytesIO(template.content))
            assert workbook.active["A1"].value == "供应商名称"
            assert workbook.active["J1"].value == "地点类型"
            workbook.active.append(["华光封装", "Global Materials", "https://example.com",
                                    "苏州工厂", "苏州", "中国", 31.3, 120.6, "封装基板", "工厂"])
            workbook.active.append(["华光封装", "Global Materials", "https://example.com",
                                    "上海工厂", "上海", "中国", 31.2, 121.5, "底填胶", "工厂"])
            buffer = io.BytesIO()
            workbook.save(buffer)
            response = client.post("/api/suppliers/import", files={"file": ("suppliers.xlsx", buffer.getvalue())})
            assert response.status_code == 200
            assert response.json()["created"] == 1
            assert response.json()["updated"] == 0
            assert len(client.get("/api/sites").json()) == 2
            assert client.get("/api/sites").json()[0]["latitude"] == 31.3
            assert client.get("/api/suppliers").json()[0]["aliases"] == "Global Materials"
    finally:
        app.dependency_overrides.clear()


def test_company_event_does_not_color_unaffected_site():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        supplier = Supplier(name="Company Risk")
        db.add(supplier)
        db.flush()
        db.add(Site(supplier_id=supplier.id, name="Plant B"))
        article = Article(source="Test", title="Company Risk shutdown", url="https://example.com/company")
        db.add(article)
        db.flush()
        db.add(RiskEvent(supplier_id=supplier.id, site_id=None, article_id=article.id,
                         title=article.title, summary="Company-level report", category="生产中断",
                         risk_level="orange", verification="unverified"))
        supplier.last_scanned_at = utcnow()
        job = ScanJob(status="partial")
        db.add(job)
        db.flush()
        supplier.last_scan_job_id = job.id
        db.commit()

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        with TestClient(app) as client:
            site = client.get("/api/sites").json()[0]
            assert site["risk_level"] == "gray"
            assert site["supplier_risk_level"] == "orange"
            assert site["coverage_status"] == "partial"
            assert "尚未确认该地点" in site["supplier_risk_summary"]
    finally:
        app.dependency_overrides.clear()


def test_patch_and_csv_update_existing_records_are_audited():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        with TestClient(app) as client:
            supplier = client.post("/api/suppliers", json={"name": "Editable"}).json()
            sid = supplier["id"]
            site_id = client.post(f"/api/suppliers/{sid}/sites", json={"name": "Plant A"}).json()["id"]
            assert client.patch(f"/api/suppliers/{sid}", json={"aliases": "Edit Co", "monitored": False}).json()["aliases"] == "Edit Co"
            assert client.patch(f"/api/sites/{site_id}", json={"site_type": "仓库", "longitude": 120.0}).json()["site_type"] == "仓库"
            data = "supplier_name,aliases,website,site_name,site_type\nEditable,New Alias,https://example.com,Plant A,工厂\n"
            response = client.post("/api/suppliers/import", files={"file": ("update.csv", data.encode())})
            assert response.json()["updated"] == 1
            assert client.get(f"/api/suppliers/{sid}").json()["aliases"] == "New Alias"
            assert client.get(f"/api/suppliers/{sid}").json()["website"] == "https://example.com"
            assert client.get("/api/sites").json()[0]["site_type"] == "工厂"
        with Session(engine) as db:
            assert [a.entity_type for a in db.scalars(select(AuditLog).order_by(AuditLog.id))] == ["supplier", "site"]
    finally:
        app.dependency_overrides.clear()


def test_only_this_round_covered_supplier_can_be_green_and_disabled_keeps_history():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        earlier = ScanJob(status="completed")
        later = ScanJob(status="completed")
        db.add_all([earlier, later])
        db.flush()
        old = Supplier(name="Old Supplier", last_scanned_at=utcnow(),
                       last_scan_job_id=earlier.id, last_scan_coverage_complete=True)
        current = Supplier(name="Current Supplier", last_scanned_at=utcnow(),
                           last_scan_job_id=later.id, last_scan_coverage_complete=True)
        db.add_all([old, current])
        db.flush()
        db.add_all([Site(supplier_id=old.id, name="Old Plant"),
                    Site(supplier_id=current.id, name="Current Plant")])
        db.commit()
        old_id = old.id

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        with TestClient(app) as client:
            by_name = {site["supplier_name"]: site for site in client.get("/api/sites").json()}
            assert by_name["Old Supplier"]["risk_level"] == "gray"
            assert by_name["Old Supplier"]["coverage_status"] == "stale"
            assert by_name["Current Supplier"]["risk_level"] == "green"
            client.patch(f"/api/suppliers/{old_id}", json={"monitored": False})
            old_site = next(s for s in client.get("/api/sites").json() if s["supplier_name"] == "Old Supplier")
            assert old_site["risk_level"] == "gray"
            assert old_site["coverage_status"] == "disabled"
            with Session(engine) as db:
                article = Article(source="Official", title="Old Plant shutdown", url="https://example.com/old")
                db.add(article)
                db.flush()
                db.add(RiskEvent(supplier_id=old_id, site_id=old_site["id"], article_id=article.id,
                                 title=article.title, summary="Historical confirmed impact",
                                 category="生产中断", risk_level="red", verification="human_reviewed"))
                db.commit()
            old_site = next(s for s in client.get("/api/sites").json() if s["supplier_name"] == "Old Supplier")
            assert old_site["risk_level"] == "red"
            assert old_site["coverage_status"] == "disabled"
    finally:
        app.dependency_overrides.clear()
