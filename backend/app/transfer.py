"""Portable SQLite/PostgreSQL JSON data transfer, preserving record IDs.

Usage: python -m backend.app.transfer export backup.json
       python -m backend.app.transfer import backup.json
Import targets must be empty or contain only the untouched fictional demo seed.
"""
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import delete, func, inspect, select, text

from .db import SessionLocal, engine, initialize_schema
from .models import Article, AuditLog, MaterialCategory, Review, RiskEvent, ScanJob, Site, SourceStatus, Supplier

ORDER = [MaterialCategory, Supplier, Site, Article, RiskEvent, Review, ScanJob, SourceStatus, AuditLog]


def canonical(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def export_data(path: Path):
    initialize_schema(engine)
    with SessionLocal() as db:
        tables = {}
        for model in ORDER:
            rows = db.scalars(select(model).order_by(model.id)).all()
            tables[model.__tablename__] = [
                {column.key: (value.isoformat() if isinstance(value, datetime) else value)
                 for column in inspect(model).columns
                 for value in [getattr(row, column.key)]}
                for row in rows
            ]
    payload = {"schema_version": 2, "tables": tables,
               "counts": {name: len(rows) for name, rows in tables.items()},
               "sha256": hashlib.sha256(canonical(tables)).hexdigest()}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Exported {sum(payload['counts'].values())} records to {path}; SHA-256 {payload['sha256']}")


def import_data(path: Path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") not in (1, 2):
        raise ValueError("Unsupported transfer schema")
    tables = payload.get("tables")
    expected = {m.__tablename__ for m in (ORDER[:-1] if payload["schema_version"] == 1 else ORDER)}
    if set(tables or {}) != expected:
        raise ValueError("Missing or unknown tables")
    if payload.get("sha256") != hashlib.sha256(canonical(tables)).hexdigest():
        raise ValueError("Transfer checksum mismatch")
    if payload.get("counts") != {name: len(rows) for name, rows in tables.items()}:
        raise ValueError("Transfer count mismatch")
    if payload["schema_version"] == 1:
        tables["audit_logs"] = []
    initialize_schema(engine)
    with SessionLocal() as db:
        if db.scalar(select(func.count(Supplier.id)).where(Supplier.is_demo.is_(False))):
            raise ValueError("Target contains real suppliers; import into a fresh database")
        # The application may already have created its fictional first-run seed.
        for model in reversed(ORDER):
            db.execute(delete(model))
        db.flush()
        for model in ORDER:
            mapper = inspect(model)
            datetime_fields = {c.key for c in mapper.columns if isinstance(c.type.python_type, type) and c.type.python_type is datetime}
            for record in tables[model.__tablename__]:
                values = dict(record)
                for key in datetime_fields:
                    if values.get(key):
                        values[key] = datetime.fromisoformat(values[key])
                db.add(model(**values))
            db.flush()
        db.commit()
    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            for model in ORDER:
                table = model.__tablename__
                connection.execute(text(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM {table}), 1), true)"))
    print(f"Imported {sum(payload['counts'].values())} records from {path}; checksum verified")


def cli():
    if len(sys.argv) != 3 or sys.argv[1] not in {"export", "import"}:
        raise SystemExit("Usage: python -m backend.app.transfer export|import PATH.json")
    path = Path(sys.argv[2]).resolve()
    if sys.argv[1] == "export":
        export_data(path)
    else:
        import_data(path)


if __name__ == "__main__":
    cli()
