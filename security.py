import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, status
from argon2 import PasswordHasher
import jwt
from config import settings

ph = PasswordHasher()

def hash_password(password: str) -> str:
    return ph.hash(password)

def verify_password(hashed_password: str, plain_password: str) -> bool:

    try:
        ph.verify(hashed_password, plain_password)
        return True
    
    except:
        return False

def create_access_token(data: dict, expires_at: datetime | None = None) -> str:
    to_encode = data.copy()

    expire = expires_at or datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({
        "exp": expire
    })

    return jwt.encode(
        to_encode,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM
    )

def decode_access_token(token: str):
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        return payload

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired"
        )

    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )

def generate_token() -> str:
    # Random opaque token for refresh and password reset links
    return secrets.token_urlsafe(32)

def hash_token(token: str) -> str:
    # Tokens are long and random, so a fast hash is enough (unlike passwords)
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
