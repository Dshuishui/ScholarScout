from typing import Optional
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models_db import User
from services.auth_service import decode_access_token, TokenError

bearer = HTTPBearer()
bearer_optional = HTTPBearer(auto_error=False)


async def user_from_token(token: str, db: AsyncSession) -> Optional[User]:
    """校验登录凭证并返回用户；凭证无效、用户不存在或已被撤销（改过密码）时返回 None。

    所有需要识别用户的地方都应该走这里，直接用 decode_token 会绕过撤销检查。
    """
    try:
        user_id, version = decode_access_token(token)
    except TokenError:
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or (user.token_version or 0) != version:
        return None
    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await user_from_token(credentials.credentials, db)
    if not user:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    return user


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_optional),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """解析 Bearer token，无 token 或无效时返回 None（不抛异常）。"""
    if not credentials:
        return None
    return await user_from_token(credentials.credentials, db)
