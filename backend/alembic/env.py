import sys
import os
from logging.config import fileConfig
from sqlalchemy import create_engine, pool
from alembic import context

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from database import Base  # noqa: E402
import models_db  # noqa: E402, F401 — registers all ORM models onto Base.metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _get_sync_url() -> str:
    """
    Derive a sync SQLAlchemy URL from the environment.
    Priority: DATABASE_URL env → alembic.ini sqlalchemy.url
    Strips async driver suffixes (+aiosqlite, +asyncpg) for Alembic compatibility.
    """
    raw = (
        os.environ.get("DATABASE_URL")
        or config.get_main_option("sqlalchemy.url")
        or "sqlite:///./scholarscout.db"
    )
    return raw.replace("+aiosqlite", "").replace("+asyncpg", "")


def run_migrations_offline() -> None:
    url = _get_sync_url()
    is_sqlite = "sqlite" in url
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=is_sqlite,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = _get_sync_url()
    is_sqlite = "sqlite" in url
    connectable = create_engine(url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=is_sqlite,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
