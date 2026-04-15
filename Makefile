.PHONY: up down migrate seed dev-backend dev-frontend

# Start all infrastructure via Docker Compose
up:
	docker compose up -d

# Stop all containers
down:
	docker compose down

# Run Alembic migrations (requires postgres running)
migrate:
	cd backend && uv run alembic upgrade head

# Start backend dev server locally (requires postgres + redis running)
dev-backend:
	cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Start Celery worker locally
dev-worker:
	cd backend && uv run celery -A app.workers.celery_app worker --loglevel=info

# Start frontend dev server
dev-frontend:
	cd frontend && npm run dev

# Download spaCy model (run once)
spacy-model:
	cd backend && uv run python -m spacy download en_core_web_sm

# Generate a Fernet encryption key
gen-key:
	cd backend && uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
