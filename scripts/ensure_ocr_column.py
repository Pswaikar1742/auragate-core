#!/usr/bin/env python3
"""
Idempotent helper to ensure the `ocr_text` column exists on `visitor_logs`.

Works for SQLite and Postgres by checking the catalog and running an
ALTER TABLE when needed. Safe to run multiple times.
"""

from __future__ import annotations

import logging
import sys

from sqlalchemy import text

try:
    # Prefer package imports when running from repo root
    from backend import database
except Exception:
    # Fallback for different PYTHONPATH usage
    import database as database

logger = logging.getLogger("ensure_ocr_column")
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

TABLE = "visitor_logs"
COLUMN = "ocr_text"


def ensure_column_sqlite(engine) -> bool:
    """Ensure column exists in SQLite. Returns True if a change was applied."""
    with engine.connect() as conn:
        rows = conn.execute(text(f"PRAGMA table_info('{TABLE}')")).mappings().all()
        if any(r.get("name") == COLUMN for r in rows):
            logger.info("Column %s already exists in %s (sqlite)", COLUMN, TABLE)
            return False

    with engine.begin() as conn:
        logger.info("Adding column %s to %s (sqlite)", COLUMN, TABLE)
        conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN {COLUMN} TEXT"))
    return True


def ensure_column_postgres(engine) -> bool:
    """Ensure column exists in Postgres. Returns True if a change was applied."""
    check_q = text(
        "SELECT 1 FROM information_schema.columns WHERE table_name = :table AND column_name = :col"
    )
    with engine.connect() as conn:
        exists = conn.execute(check_q, {"table": TABLE, "col": COLUMN}).fetchone() is not None
        if exists:
            logger.info("Column %s already exists in %s (postgres)", COLUMN, TABLE)
            return False

    with engine.begin() as conn:
        logger.info("Adding column %s to %s (postgres)", COLUMN, TABLE)
        conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN {COLUMN} TEXT"))
    return True


def main() -> int:
    engine = database.engine
    driver = engine.dialect.name
    logger.info("DB driver detected: %s", driver)

    try:
        if driver and driver.startswith("sqlite"):
            changed = ensure_column_sqlite(engine)
        elif driver and (driver.startswith("postgresql") or driver.startswith("postgres")):
            changed = ensure_column_postgres(engine)
        else:
            logger.error("Unsupported DB driver: %s", driver)
            return 2
    except Exception:
        logger.exception("Failed to ensure column %s on %s", COLUMN, TABLE)
        return 2

    if changed:
        logger.info("Schema change applied.")
    else:
        logger.info("No change required.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
