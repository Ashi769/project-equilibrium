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

# Install ML deps into the venv (CPU-only torch)
RUN uv pip install -r requirements-ml.txt

# Download spaCy model into venv
RUN uv run python -m spacy download en_core_web_sm

# Pre-download sentence-transformers model into image (cache baked into /app/.cache)
ENV HF_HOME=/app/.cache/huggingface
RUN uv run python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY . .

EXPOSE 8000

ENV HF_HOME=/app/.cache/huggingface

COPY start.sh .
RUN chmod +x start.sh
CMD ["sh", "start.sh"]
