#!/usr/bin/env bash
set -euo pipefail

# Convenience script to run the DB initialization inside a remote/container environment (Railway, etc.).
# Usage examples:
#   railway run ./scripts/init_db_remote.sh
#   AURAGATE_REQUIRE_DB_ON_STARTUP=false ./scripts/init_db_remote.sh

: "${DATABASE_URL:?DATABASE_URL must be set in environment (Railway variable)}"
export AURAGATE_REQUIRE_DB_ON_STARTUP=${AURAGATE_REQUIRE_DB_ON_STARTUP:-false}

echo "Starting database initialization"
echo "AURAGATE_REQUIRE_DB_ON_STARTUP=${AURAGATE_REQUIRE_DB_ON_STARTUP}"
echo "(DATABASE_URL present: ${DATABASE_URL:+yes})"

python -m backend.init_db

echo "Database initialization complete."
