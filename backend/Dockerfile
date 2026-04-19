FROM python:3.12-slim

WORKDIR /app

# System deps for spaCy, psycopg, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency files
COPY pyproject.toml uv.lock* requirements-ml.txt ./

# Install main deps
RUN uv sync --frozen --no-dev

# Install ML deps (torch + sentence-transformers, Linux wheels only)
RUN uv pip install --system -r requirements-ml.txt

# Download spaCy model
RUN uv run python -m spacy download en_core_web_sm

# Pre-download sentence-transformers model (best-effort, downloads on first use if this fails)
RUN uv run python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')" || echo "Model will download on first use"

COPY . .

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
