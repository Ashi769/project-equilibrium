import time
import contextlib
from threading import local

from prometheus_client import Counter, Histogram

_tl = local()

DB_QUERY_DURATION = Histogram(
    "db_query_duration_seconds",
    "SQLAlchemy query execution time",
    ["operation"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
)
DB_ERRORS = Counter(
    "db_errors_total",
    "SQLAlchemy query errors",
    ["operation"],
)

EXTERNAL_CALL_DURATION = Histogram(
    "external_call_duration_seconds",
    "Duration of outbound API calls",
    ["service", "success"],
    buckets=[0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
)
EXTERNAL_CALL_ERRORS = Counter(
    "external_call_errors_total",
    "Outbound API call errors",
    ["service"],
)

REDIS_PING_DURATION = Histogram(
    "redis_ping_duration_seconds",
    "Redis ping round-trip latency",
    buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
)


def _op(stmt: str) -> str:
    prefix = stmt.strip().upper()[:10]
    for op in ("SELECT", "INSERT", "UPDATE", "DELETE", "BEGIN", "COMMIT", "ROLLBACK"):
        if prefix.startswith(op):
            return op
    return "OTHER"


def instrument_sqlalchemy(engine) -> None:
    from sqlalchemy import event

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def _before(conn, cursor, statement, parameters, context, executemany):
        _tl.t0 = time.perf_counter()
        _tl.op = _op(statement)

    @event.listens_for(engine.sync_engine, "after_cursor_execute")
    def _after(conn, cursor, statement, parameters, context, executemany):
        if (t0 := getattr(_tl, "t0", None)) is not None:
            DB_QUERY_DURATION.labels(operation=_tl.op).observe(time.perf_counter() - t0)

    @event.listens_for(engine.sync_engine, "handle_error")
    def _err(ctx):
        DB_ERRORS.labels(operation=getattr(_tl, "op", "OTHER")).inc()


@contextlib.contextmanager
def track_external_call(service: str):
    t0 = time.perf_counter()
    ok = True
    try:
        yield
    except Exception:
        ok = False
        EXTERNAL_CALL_ERRORS.labels(service=service).inc()
        raise
    finally:
        EXTERNAL_CALL_DURATION.labels(service=service, success=str(ok)).observe(
            time.perf_counter() - t0
        )
