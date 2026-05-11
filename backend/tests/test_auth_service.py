import pytest
from services.auth_service import hash_password, verify_password, create_access_token, decode_token


def test_hash_and_verify_password():
    hashed = hash_password("mysecret123")
    assert verify_password("mysecret123", hashed)
    assert not verify_password("wrongpassword", hashed)


def test_hash_is_different_each_time():
    h1 = hash_password("same")
    h2 = hash_password("same")
    assert h1 != h2


def test_create_and_decode_token():
    token = create_access_token(42)
    assert decode_token(token) == 42


def test_decode_invalid_token_raises():
    from jose import JWTError
    with pytest.raises(JWTError):
        decode_token("not.a.valid.token")
