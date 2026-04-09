"""Utility script to initialize the database schema and seed demo residents.

Run from the repository root with:

    python -m backend.init_db

This is useful to perform a one-off DB initialization step (for example via
Railway's "Run" command or CI job) after the database plugin is provisioned.
"""

from __future__ import annotations

from .database import create_db_and_tables
from .main import _seed_demo_residents


def main() -> None:
    print("Initializing database schema...")
    create_db_and_tables()
    print("Seeding demo residents (if any)...")
    _seed_demo_residents()
    print("Done: database initialized and demo residents seeded.")


if __name__ == "__main__":
    main()
