# Project Equilibrium

AI-powered matchmaking platform using psychometric profiling and vector similarity.

## Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, NextAuth v5
- **Backend**: Python 3.12, FastAPI, PostgreSQL 16 + pgvector, Redis, Celery
- **AI**: Groq (interviewer), Gemini 1.5 Flash (analyst), sentence-transformers (embeddings)

## Quick Start

```bash
cp .env.example .env
# Fill in secrets in .env

# Start infrastructure + backend
docker compose up -d

# Frontend dev server
cd frontend && npm install && npm run dev
```

Backend API docs: http://localhost:8000/docs  
Frontend: http://localhost:3000

## Project Structure

```
project-equilibrium/
├── frontend/     # Next.js 14 website
├── backend/      # FastAPI monolith
└── docker-compose.yml
```
