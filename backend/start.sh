#!/bin/sh
set -e

MIGRATION_LOCK="/tmp/migration.lock"

acquire_lock() {
    exec 200>$MIGRATION_LOCK
    flock -n 200 || return 1
    echo $$ >&200
    return 0
}

if acquire_lock; then
    echo "=== Running migrations ==="
    .venv/bin/alembic upgrade head
    echo "=== Migrations done ==="
    rm -f $MIGRATION_LOCK
else
    echo "Another process running migrations, waiting..."
    for i in $(seq 1 30); do
        sleep 1
        if [ ! -f $MIGRATION_LOCK ]; then
            echo "Migrations complete"
            break
        fi
    done
fi

echo "=== Starting uvicorn ==="
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2