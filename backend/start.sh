#!/bin/sh
set -e

PORT=${PORT:-8000}
echo "=== Starting on port $PORT ==="

LOCKFILE="/tmp/migration.done"

if [ ! -f "$LOCKFILE" ]; then
    echo "=== Running migrations ==="
    .venv/bin/alembic upgrade head
    echo "=== Migrations done ==="
    touch "$LOCKFILE"
fi

echo "=== Starting uvicorn ==="
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $PORT