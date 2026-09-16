import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from main import app
from database import get_db
from models_db import Base, User
from services.auth_service import hash_password, create_access_token

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def db_engine():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db_session(db_engine):
    session_factory = sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.fixture
async def client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def reset_rate_limits():
    """清空内存限流状态，防止跨测试污染。"""
    import routers.auth as auth_router
    auth_router._register_attempts.clear()
    auth_router._login_failures.clear()
    auth_router._resend_attempts.clear()
    auth_router._reset_attempts.clear()
    import routers.feedback as feedback_router
    feedback_router._reaction_ips.clear()
    import routers.search as search_router
    search_router._trial_parse_attempts.clear()
    # 进程内缓存也要清，否则用例之间会相互影响
    from services import cache_service, llm_service
    cache_service._memory_cache.clear()
    llm_service._parse_cache.clear()
    import routers.chat as chat_router
    chat_router._chat_attempts.clear()
    import routers.translate as translate_router
    translate_router._attempts.clear()
    translate_router._cache.clear()
    translate_router._site_attempts.clear()
    import routers.subscriptions as subs_router
    subs_router._create_attempts.clear()
    subs_router._refresh_attempts.clear()
    subs_router._test_send_attempts.clear()
    yield


async def make_verified_user(db_session: AsyncSession, email: str = "u@test.com", password: str = "password123") -> tuple[User, str]:
    """在 DB 中直接创建已验证用户，返回 (user, jwt_token)。不走邮件验证流程。"""
    user = User(
        email=email,
        password_hash=hash_password(password),
        is_verified=True,
        free_searches=0,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token = create_access_token(user.id)
    return user, token
