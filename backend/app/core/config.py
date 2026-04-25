from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
import os


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    port: int = int(os.environ.get("PORT", "8000"))
    environment: str = "development"
    allowed_origins: str = "http://localhost:3000"

    # Database
    database_url: str = (
        "postgresql+asyncpg://equilibrium:equilibrium@localhost:5432/equilibrium"
    )

    @property
    def async_database_url(self) -> str:
        url = self.database_url
        if "+asyncpg" not in url:
            if url.startswith("postgresql://"):
                url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
            elif url.startswith("postgresql+"):
                url = url.replace("postgresql+", "postgresql+asyncpg://", 1)
        return url

    # Redis / Celery
    redis_url: str = ""
    celery_broker_url: str = ""
    celery_result_backend: str = ""

    @property
    def resolved_redis_url(self) -> str:
        return self.redis_url or "redis://localhost:6379/0"

    @property
    def resolved_celery_broker_url(self) -> str:
        return (
            self.celery_broker_url or f"{self.resolved_redis_url.rsplit('/', 1)[0]}/1"
        )

    @property
    def resolved_celery_result_backend(self) -> str:
        return (
            self.celery_result_backend
            or f"{self.resolved_redis_url.rsplit('/', 1)[0]}/2"
        )

    # JWT
    secret_key: str = "change_me_in_production"
    access_token_expire_minutes: int = 60 * 24  # 24 hours
    refresh_token_expire_days: int = 30

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""

    # AI APIs
    groq_api_key: str = ""
    gemini_api_key: str = ""

    # Cloudflare R2
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "equilibrium-photos"

    # Encryption
    transcript_encryption_key: str = ""

    # Debug APIs
    debug_api_token: str = ""

    # Interview (set to 2 for fast dev testing, 6 for production)
    interview_min_topics: int = 6

    # Invitation system
    max_invitations_per_woman: int = 2

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
