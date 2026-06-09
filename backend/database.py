import os
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = "sqlite+aiosqlite:///./scholarscout.db"
engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def _run_alembic() -> None:
    """Sync: stamp existing DB if untracked, then run upgrade head."""
    from sqlalchemy import create_engine, inspect
    from alembic.config import Config
    from alembic import command

    sync_url = DATABASE_URL.replace("+aiosqlite", "")
    sync_engine = create_engine(sync_url)
    tables = inspect(sync_engine).get_table_names()
    sync_engine.dispose()

    ini_path = os.path.join(os.path.dirname(__file__), "alembic.ini")
    alembic_cfg = Config(ini_path)

    if tables and "alembic_version" not in tables:
        # Existing DB deployed before Alembic was introduced — stamp as current.
        command.stamp(alembic_cfg, "head")
    else:
        command.upgrade(alembic_cfg, "head")


async def init_db() -> None:
    await asyncio.to_thread(_run_alembic)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
