"""Database configuration and session management for AuraGate."""

from __future__ import annotations

import os
from typing import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


def _normalize_database_url(raw_url: str) -> str:
    """Normalize DB URL to the expected SQLAlchemy driver format.

    Some cloud providers still expose `postgres://...`, which SQLAlchemy no
    longer accepts. Rewrite that legacy scheme to `postgresql://...`.
    """

    normalized = raw_url
    if normalized.startswith("postgres://"):
        normalized = normalized.replace("postgres://", "postgresql://", 1)

    # Prefer psycopg3 explicitly. This avoids relying on SQLAlchemy's default
    # postgres driver resolution, which may pick psycopg2 in environments where
    # it is unavailable or incompatible.
    if normalized.startswith("postgresql://"):
        normalized = normalized.replace("postgresql://", "postgresql+psycopg://", 1)

    try:
        parsed = make_url(normalized)
    except Exception:
        return normalized

    # If `@` in password is not URL-encoded, URL parsing can shift the suffix
    # into host (e.g., host becomes `6801@aws-1-...`). Repair that shape.
    if parsed.password and parsed.host and "@" in parsed.host:
        password_suffix, repaired_host = parsed.host.split("@", 1)
        parsed = parsed.set(password=f"{parsed.password}@{password_suffix}", host=repaired_host)

    # Render canonical URL form so reserved chars in credentials stay encoded.
    return parsed.render_as_string(hide_password=False)

DATABASE_URL = _normalize_database_url(
    os.getenv(
        "DATABASE_URL",
        "sqlite:///./auragate.db",
    )
)

# `pool_pre_ping` avoids stale connection failures in long-running services.
# SQLite needs `check_same_thread=False` for FastAPI/TestClient thread usage.
# Postgres must not receive this SQLite-only argument.
engine_kwargs: dict[str, object] = {"pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_kwargs)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""


def database_driver_name() -> str:
    """Return the current configured DB driver name (e.g., sqlite, postgresql)."""

    if DATABASE_URL.startswith("sqlite"):
        return "sqlite"

    try:
        parsed = make_url(DATABASE_URL)
    except Exception:
        return "unknown"

    return parsed.drivername.split("+", 1)[0]


def database_target_name() -> str:
    """Return a non-sensitive DB target label suitable for logs/health responses."""

    if DATABASE_URL.startswith("sqlite"):
        return "sqlite-local"

    try:
        parsed = make_url(DATABASE_URL)
    except Exception:
        return "unknown"

    if parsed.host:
        return parsed.host

    return "unknown"


def check_database_connection() -> tuple[bool, str | None]:
    """Verify database connectivity with a lightweight `SELECT 1` probe."""

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True, None
    except Exception as exc:  # pragma: no cover - runtime connectivity branch
        return False, str(exc)


def get_db() -> Generator[Session, None, None]:
    """Provide a request-scoped database session."""

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_db_and_tables() -> None:
    """Create tables for all registered SQLAlchemy models."""

    Base.metadata.create_all(bind=engine)
