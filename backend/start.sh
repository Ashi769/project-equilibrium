#!/bin/sh
set -ex

PORT=${PORT:-8000}
HOST=${HOST:-0.0.0.0}
echo "=== Starting on $HOST:$PORT ==="

if [ "$CELERY_WORKER" = "1" ]; then
    echo "=== Starting Celery worker ==="
    exec .venv/bin/celery -A app.workers.celery_app worker --loglevel=info --concurrency=2
fi

echo "=== Starting on port $PORT ==="

LOCKFILE="/tmp/migration.done"

if [ ! -f "$LOCKFILE" ]; then
    echo "=== Running migrations ==="
    .venv/bin/alembic upgrade head || echo "=== Migration failed, ignoring ==="
    echo "=== Migrations done ==="
    touch "$LOCKFILE"
fi

echo "=== Starting uvicorn ==="
exec .venv/bin/uvicorn app.main:app --host $HOST --port $PORT