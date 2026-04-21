#!/bin/sh
set -e

PORT=8000
HOST=${HOST:-0.0.0.0}

LOCKFILE="/tmp/migration.done"

if [ ! -f "$LOCKFILE" ]; then
    echo "=== Running migrations ==="
    .venv/bin/alembic upgrade head || echo "=== Migration failed, ignoring ==="
    echo "=== Migrations done ==="
    touch "$LOCKFILE"
fi

echo "=== Starting uvicorn and celery ==="

# Run both in background
.venv/bin/uvicorn app.main:app --host $HOST --port $PORT &
UVICORN_PID=$!

.venv/bin/celery -A app.workers.celery_app worker --loglevel=info --concurrency=1 &
CELERY_PID=$!

# Wait for either to exit
trap "kill $UVICORN_PID $CELERY_PID 2>/dev/null" EXIT
wait
