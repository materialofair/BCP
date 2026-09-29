"""Database configuration shared by the API and the single collector worker."""
import os
from pathlib import Path
from dotenv import load_dotenv

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def default_database_url() -> str:
    data_dir = Path(os.getenv("BCP_DATA_DIR", "data")).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{data_dir / 'bcp.sqlite3'}"


DATABASE_URL = os.getenv("DATABASE_URL") or default_database_url()
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30} if DATABASE_URL.startswith("sqlite") else {},
    pool_pre_ping=True,
)
if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def sqlite_settings(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def initialize_schema(target_engine=None):
    """Create tables and apply the small additive v0.1 schema changes."""
    target_engine = target_engine or engine
    Base.metadata.create_all(target_engine)
    changes = {
        "suppliers": {"last_scanned_at": "TIMESTAMP", "last_scan_job_id": "INTEGER",
                      "last_scan_coverage_complete": "BOOLEAN DEFAULT 0", "search_cursor": "INTEGER DEFAULT 0"},
        "risk_events": {"auto_risk_level": "VARCHAR(20)"},
        "reviews": {"previous_risk_level": "VARCHAR(20)", "risk_level": "VARCHAR(20)"},
        "scan_jobs": {"lease_updated_at": "TIMESTAMP", "attempts": "INTEGER DEFAULT 0"},
    }
    with target_engine.begin() as connection:
        inspector = inspect(connection)
        for table, columns in changes.items():
            existing = {column["name"] for column in inspector.get_columns(table)}
            for name, sql_type in columns.items():
                if name not in existing:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))
        connection.execute(text("UPDATE risk_events SET auto_risk_level = risk_level WHERE auto_risk_level IS NULL"))


def get_db():
    with SessionLocal() as session:
        yield session
