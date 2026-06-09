import os
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# Support PostgreSQL in production (set DATABASE_URL env var) or SQLite for local dev.
# Accepted formats:
#   sqlite+aiosqlite:///./scholarscout.db          (default)
#   postgresql+asyncpg://user:pass@host/db
#   postgresql://user:pass@host/db                 (auto-upgraded to +asyncpg)
_raw = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./scholarscout.db")

# Ensure correct async driver
if "postgresql" in _raw and "+asyncpg" not in _raw:
    DATABASE_URL = _raw.replace("postgresql://", "postgresql+asyncpg://", 1)
else:
    DATABASE_URL = _raw

_IS_SQLITE = DATABASE_URL.startswith("sqlite")

_engine_kwargs: dict = {"echo": False}
if not _IS_SQLITE:
    _engine_kwargs.update({"pool_size": 5, "max_overflow": 10, "pool_pre_ping": True})

engine = create_async_engine(DATABASE_URL, **_engine_kwargs)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def _run_alembic() -> None:
    """Sync: stamp existing DB if untracked, then run upgrade head."""
    from sqlalchemy import create_engine, inspect
    from alembic.config import Config
    from alembic import command

    # Convert async URL → sync URL for Alembic / SQLAlchemy sync engine
    sync_url = (
        DATABASE_URL
        .replace("+aiosqlite", "")
        .replace("+asyncpg", "")
    )
    # Alembic needs the env var set for env.py to pick it up
    os.environ.setdefault("DATABASE_URL", DATABASE_URL)

    sync_engine = create_engine(sync_url)
    tables = inspect(sync_engine).get_table_names()
    sync_engine.dispose()

    ini_path = os.path.join(os.path.dirname(__file__), "alembic.ini")
    alembic_cfg = Config(ini_path)

    if tables and "alembic_version" not in tables:
        # Existing DB deployed before Alembic — stamp as current.
        command.stamp(alembic_cfg, "head")
    else:
        command.upgrade(alembic_cfg, "head")


async def init_db() -> None:
    await asyncio.to_thread(_run_alembic)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
