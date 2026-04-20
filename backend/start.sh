#!/bin/sh
set -e
echo "=== Running migrations ==="
uv run alembic upgrade head
echo "=== Migrations done, starting uvicorn ==="
exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
