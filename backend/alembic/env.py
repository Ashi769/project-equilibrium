import asyncio
from logging.config import fileConfig
import sqlalchemy as sa
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context
from app.core.config import settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option(
    "sqlalchemy.url",
    settings.database_url.replace("+asyncpg", ""),
)


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, renderers=[])
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = create_async_engine(
        settings.async_database_url,
        poolclass=pool.NullPool,
        pool_pre_ping=True,
    )

    async with connectable.connect() as conn:
        await conn.execute(sa.text("COMMIT"))

        result = await conn.execute(
            sa.text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='matches' AND column_name='user_a_id' AND table_schema='public'"
            )
        )
        if result.fetchone():
            await conn.execute(
                sa.text("ALTER TABLE matches RENAME COLUMN user_a_id TO user_id")
            )
            await conn.execute(
                sa.text(
                    "ALTER TABLE matches RENAME COLUMN user_b_id TO matched_user_id"
                )
            )

        await conn.commit()

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
