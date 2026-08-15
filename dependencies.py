from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, HTTPBearer, HTTPAuthorizationCredentials

from sqlalchemy.orm import Session

from database import connect_db
from models import User, TripGuestAccess
from security import decode_access_token

security = HTTPBearer()

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/auth/login"
)

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(connect_db)
):

    token = credentials.credentials
    payload = decode_access_token(token)
    
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )

    user_id = int(payload.get("sub"))

    user = db.query(User).filter(
        User.id == user_id
    ).first()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )

    return user

def get_current_guest(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(connect_db)
):
    token = credentials.credentials
    payload = decode_access_token(token)
    
    guest_id = payload.get("sub")

    if guest_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )

    if payload.get("type") != "guest":
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid guest token"
    )

    guest_id = int(payload.get("sub"))

    guest = db.query(TripGuestAccess).filter(
        TripGuestAccess.id == guest_id
    ).first()

    if guest is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )

    if guest.expires_at is not None and guest.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Guest access has expired"
        )
    
    return guest