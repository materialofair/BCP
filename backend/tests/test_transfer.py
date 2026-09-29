from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.db import Base
from backend.app.models import Site, Supplier
from backend.app import transfer


def memory_engine():
    return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


def test_transfer_preserves_relations_and_detects_tampering(tmp_path, monkeypatch):
    source = memory_engine()
    Base.metadata.create_all(source)
    with Session(source) as db:
        supplier = Supplier(name="Real Co")
        db.add(supplier)
        db.flush()
        db.add(Site(supplier_id=supplier.id, name="Plant 1", latitude=10, longitude=20))
        db.commit()
    monkeypatch.setattr(transfer, "engine", source)
    monkeypatch.setattr(transfer, "SessionLocal", sessionmaker(bind=source))
    file = tmp_path / "backup.json"
    transfer.export_data(file)
    target = memory_engine()
    monkeypatch.setattr(transfer, "engine", target)
    monkeypatch.setattr(transfer, "SessionLocal", sessionmaker(bind=target))
    transfer.import_data(file)
    with Session(target) as db:
        site = db.scalar(select(Site))
        assert site.supplier_id == db.scalar(select(Supplier)).id
        assert site.latitude == 10
    file.write_text(file.read_text().replace("Real Co", "Tampered"))
    try:
        transfer.import_data(file)
    except ValueError as exc:
        assert "checksum" in str(exc)
    else:
        raise AssertionError("Tampered data accepted")
