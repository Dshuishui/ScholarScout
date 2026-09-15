import os
from datetime import datetime, timedelta, timezone

import jwt
from passlib.context import CryptContext

# Use pbkdf2_sha256 as default - more stable than bcrypt with current environment
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-only-secret-change-me-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30

# 所有凭证解析失败都抛这个异常（以前用的 python-jose 已停止维护，换成 PyJWT；HS256 签名兼容，旧凭证照常可用）
TokenError = jwt.PyJWTError


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: int, token_version: int = 0) -> str:
    """登录凭证。ver 对应 users.token_version：改密码时版本号 +1，之前签发的凭证全部失效。"""
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": str(user_id), "ver": token_version, "exp": expire}, JWT_SECRET, algorithm=ALGORITHM)


def decode_access_token(token: str) -> tuple[int, int]:
    """返回 (user_id, token_version)。不带 ver 的旧凭证视为版本 0。

    只校验签名和有效期；凭证是否已被撤销要和数据库里的 token_version 比较，见 dependencies.user_from_token。
    """
    payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    # 带 purpose 的是专用 token（如退订链接），不能当登录凭据用
    if payload.get("purpose") or "sub" not in payload:
        raise jwt.InvalidTokenError("not an access token")
    try:
        return int(payload["sub"]), int(payload.get("ver", 0))
    except (TypeError, ValueError):
        raise jwt.InvalidTokenError("malformed access token")


def decode_token(token: str) -> int:
    return decode_access_token(token)[0]


UNSUBSCRIBE_PURPOSE = "unsubscribe"


def create_unsubscribe_token(sub_id: int) -> str:
    """邮件退订链接用的 token。不设过期：旧邮件里的链接也要能退订。"""
    return jwt.encode({"sid": str(sub_id), "purpose": UNSUBSCRIBE_PURPOSE}, JWT_SECRET, algorithm=ALGORITHM)


def decode_unsubscribe_token(token: str) -> int:
    payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    if payload.get("purpose") != UNSUBSCRIBE_PURPOSE or "sid" not in payload:
        raise jwt.InvalidTokenError("not an unsubscribe token")
    return int(payload["sid"])
