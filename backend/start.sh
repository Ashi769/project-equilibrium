#!/bin/sh
set -e

LOCKFILE="/tmp/migration.done"

if [ ! -f "$LOCKFILE" ]; then
    echo "=== Running migrations ==="
    .venv/bin/alembic upgrade head
    echo "=== Migrations done ==="
    touch "$LOCKFILE"
fi

echo "=== Starting uvicorn ==="
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2