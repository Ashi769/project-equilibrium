import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.api.v1 import (
    auth,
    debug,
    interview,
    matches,
    profile,
    photos,
    schedule,
    signal,
)

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Project Equilibrium API",
    version="0.1.0",
    docs_url="/docs" if settings.environment == "development" else None,
    redoc_url=None,
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    response = await call_next(request)
    return response


app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(debug.router, prefix="/api/v1")
app.include_router(interview.router, prefix="/api/v1")
app.include_router(matches.router, prefix="/api/v1")
app.include_router(profile.router, prefix="/api/v1")
app.include_router(photos.router, prefix="/api/v1")
app.include_router(schedule.router, prefix="/api/v1")
app.include_router(signal.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
