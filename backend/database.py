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
            "ALTER TABLE paper_chats ADD COLUMN pdf_text TEXT",
            "ALTER TABLE feedback ADD COLUMN category VARCHAR(20) DEFAULT 'chat'",
            # 邮箱验证 & 免费搜索额度（老用户默认已验证 is_verified=1，free_searches=0）
            "ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 1",
            "ALTER TABLE users ADD COLUMN verify_token VARCHAR(64)",
            "ALTER TABLE users ADD COLUMN verify_token_expires DATETIME",
            "ALTER TABLE users ADD COLUMN free_searches INTEGER DEFAULT 0",
            # subscriptions 表由 create_all 自动创建，无需手动迁移
            # subscription_queue 表由 create_all 自动创建
            "ALTER TABLE subscriptions ADD COLUMN daily_limit INTEGER DEFAULT 1",
        ]:
            try:
                await conn.execute(text(sql))
            except Exception:
                pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
