import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from prometheus_fastapi_instrumentator import Instrumentator
from prometheus_fastapi_instrumentator.metrics import default, latency

from app.core.config import settings
from app.core.database import engine
from app.core.metrics import instrument_sqlalchemy, REDIS_PING_DURATION
from app.api.v1 import (
    auth,
    debug,
    interview,
    invitations,
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

# Prometheus: only the two metrics we care about
#   - http_requests_total          → error rate via rate(...) + status class label
#   - http_request_duration_seconds → p50/p75/p99 via histogram_quantile(...)
# Buckets chosen for a typical API: ignore sub-10ms noise, flag anything >2s
_LATENCY_BUCKETS = (0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0)

(
    Instrumentator(
        should_group_status_codes=True,   # 2xx / 4xx / 5xx — avoids per-code cardinality
        should_group_untemplated=True,    # collapse unmapped paths to "<unspecified>"
        excluded_handlers=["/metrics", "/health"],
    )
    .add(default(latency_highr_buckets=_LATENCY_BUCKETS, latency_lowr_buckets=_LATENCY_BUCKETS))
    .instrument(app)
    .expose(app, include_in_schema=False)
)

# SQLAlchemy query latency + error metrics
instrument_sqlalchemy(engine)

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
app.include_router(invitations.router, prefix="/api/v1")
app.include_router(interview.router, prefix="/api/v1")
app.include_router(matches.router, prefix="/api/v1")
app.include_router(profile.router, prefix="/api/v1")
app.include_router(photos.router, prefix="/api/v1")
app.include_router(schedule.router, prefix="/api/v1")
app.include_router(signal.router)


@app.get("/health")
async def health():
    checks: dict = {"api": "ok"}

    # DB ping
    try:
        from sqlalchemy import text
        from app.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        checks["db"] = "ok"
    except Exception as exc:
        checks["db"] = f"error: {exc}"

    # Redis ping
    try:
        import redis.asyncio as aioredis
        t0 = time.perf_counter()
        r = aioredis.from_url(settings.resolved_redis_url, socket_connect_timeout=2)
        await r.ping()
        await r.aclose()
        latency = time.perf_counter() - t0
        REDIS_PING_DURATION.observe(latency)
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {exc}"

    status = "ok" if all(v == "ok" for v in checks.values()) else "degraded"
    return {"status": status, **checks}
