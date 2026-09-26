from datetime import datetime, timezone
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, HTTPBearer, HTTPAuthorizationCredentials

from sqlalchemy.orm import Session

from database import connect_db
from models import User, TripGuestAccess, TripMembership
from security import decode_access_token
from validators import as_utc

security = HTTPBearer()

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/auth/login"
)

EDITOR_ROLES = ["owner", "member"]

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

    # Guest tokens share the same signing key, so make sure one can't be used as a user token
    if payload.get("type") == "guest":
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

    if guest.expires_at is not None and as_utc(guest.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Guest access has expired"
        )

    return guest

def get_trip_membership(
    trip_id: int,
    db: Session = Depends(connect_db),
    current_user: User = Depends(get_current_user)
):
    membership = (
        db.query(TripMembership)
        .filter(
            TripMembership.trip_id == trip_id,
            TripMembership.user_id == current_user.id
        )
        .first()
    )

    # 404 rather than 403 so non-members can't tell whether a trip exists
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found"
        )

    return membership

def require_role(membership: TripMembership, roles: list[str]):
    if membership.role not in roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permission"
        )
