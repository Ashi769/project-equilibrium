from celery import Celery
from celery.schedules import crontab
from app.core.config import settings

celery_app = Celery(
    "equilibrium",
    broker=settings.resolved_celery_broker_url,
    backend=settings.resolved_celery_result_backend,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,
)

celery_app.conf.beat_schedule = {
    "daily-match-refresh": {
        "task": "app.workers.tasks.refresh_daily_matches",
        "schedule": crontab(hour=3, minute=0),
        "options": {"queue": "default"},
    },
    "no-show-check": {
        "task": "app.workers.tasks.check_no_shows",
        "schedule": crontab(minute="*/30"),
        "options": {"queue": "default"},
    },
}
