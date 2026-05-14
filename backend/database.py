from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy import text

DATABASE_URL = "sqlite+aiosqlite:///./scholarscout.db"
engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # 为已存在的 feedback 表补充新列（SQLite 不支持 IF NOT EXISTS，用 try/except）
        for sql in [
            "ALTER TABLE feedback ADD COLUMN location TEXT",
            "ALTER TABLE feedback ADD COLUMN is_author INTEGER DEFAULT 0",
            "ALTER TABLE feedback ADD COLUMN user_id INTEGER",
            "ALTER TABLE feedback ADD COLUMN reply_to_id INTEGER",
            "ALTER TABLE feedback ADD COLUMN recalled INTEGER DEFAULT 0",
        ]:
            try:
                await conn.execute(text(sql))
            except Exception:
                pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
