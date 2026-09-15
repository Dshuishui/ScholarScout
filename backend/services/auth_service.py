import os
from datetime import datetime, timedelta
from jose import jwt, JWTError
from passlib.context import CryptContext

# Use pbkdf2_sha256 as default - more stable than bcrypt with current environment
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": str(user_id), "exp": expire}, JWT_SECRET, algorithm=ALGORITHM)


def decode_token(token: str) -> int:
    payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    # 带 purpose 的是专用 token（如退订链接），不能当登录凭据用
    if payload.get("purpose") or "sub" not in payload:
        raise JWTError("not an access token")
    return int(payload["sub"])


UNSUBSCRIBE_PURPOSE = "unsubscribe"


def create_unsubscribe_token(sub_id: int) -> str:
    """邮件退订链接用的 token。不设过期：旧邮件里的链接也要能退订。"""
    return jwt.encode({"sid": str(sub_id), "purpose": UNSUBSCRIBE_PURPOSE}, JWT_SECRET, algorithm=ALGORITHM)


def decode_unsubscribe_token(token: str) -> int:
    payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    if payload.get("purpose") != UNSUBSCRIBE_PURPOSE or "sid" not in payload:
        raise JWTError("not an unsubscribe token")
    return int(payload["sid"])
