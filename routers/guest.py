import secrets
import string
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from config import settings
from database import connect_db
from models import Trip, TripMembership, TripGuestAccess, Activity
from schemas import GuestAccessCreate, GuestAccessSetup, GuestAccessResponse, Token, TripResponse, ActivityResponse, ItineraryResponse
from security import create_access_token, verify_password, hash_password
from dependencies import get_current_guest, get_trip_membership, require_role
from routers.activities import build_itinerary
from validators import as_utc

router = APIRouter(
    prefix="/guest",
    tags=["Guest Access"]
)

# Owner-facing endpoints for managing a trip's guest code
setup_router = APIRouter(
    prefix="/trips/{trip_id}/guest-access",
    tags=["Guest Access"]
)

ACCESS_CODE_ALPHABET = string.ascii_uppercase + string.digits
ACCESS_CODE_LENGTH = 8

def generate_access_code(db: Session) -> str:
    while True:
        code = "".join(secrets.choice(ACCESS_CODE_ALPHABET) for _ in range(ACCESS_CODE_LENGTH))
        exists = db.query(TripGuestAccess).filter(
            TripGuestAccess.access_code == code
        ).first()
        if exists is None:
            return code

@router.post("/access", response_model=Token)
def guest_access(
    guest_access_create: GuestAccessCreate,
    db: Session = Depends(connect_db)
):
    # Codes are shown in capitals, but people often type them in lower case
    access_code = guest_access_create.access_code.strip().upper()
    guest_access = db.query(TripGuestAccess).filter(
        TripGuestAccess.access_code == access_code
    ).first()
    if guest_access is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
    if not verify_password(guest_access.pin_hash, guest_access_create.pin):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
    if guest_access.expires_at is not None and as_utc(guest_access.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Guest access has expired"
        )
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.GUEST_TOKEN_EXPIRE_HOURS)
    if guest_access.expires_at is not None:
        expires_at = min(expires_at, as_utc(guest_access.expires_at))
    token = create_access_token(
        {"sub": str(guest_access.id), "type": "guest", "trip_id": str(guest_access.trip_id)},
        expires_at=expires_at
    )
    return {"access_token": token, "token_type": "bearer"}

@router.get("/trip", response_model=TripResponse)
def get_guest_trip(
    db: Session = Depends(connect_db),
    guest: TripGuestAccess = Depends(get_current_guest)
):
    return db.query(Trip).filter(Trip.id == guest.trip_id).first()

@router.get("/activities", response_model=list[ActivityResponse])
def get_guest_activities(
    db: Session = Depends(connect_db),
    guest: TripGuestAccess = Depends(get_current_guest)
):
    activities = (
        db.query(Activity)
        .filter(Activity.trip_id == guest.trip_id)
        .order_by(Activity.start_time, Activity.id)
        .all()
    )

    return activities

@router.get("/itinerary", response_model=ItineraryResponse)
def get_guest_itinerary(
    db: Session = Depends(connect_db),
    guest: TripGuestAccess = Depends(get_current_guest)
):
    activities = (
        db.query(Activity)
        .filter(Activity.trip_id == guest.trip_id)
        .order_by(Activity.start_time, Activity.id)
        .all()
    )

    return build_itinerary(db, guest.trip_id, activities)

@setup_router.put("", response_model=GuestAccessResponse)
def set_guest_access(
    trip_id: int,
    guest_access_setup: GuestAccessSetup,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, ["owner"])

    guest_access = db.query(TripGuestAccess).filter(
        TripGuestAccess.trip_id == trip_id
    ).first()

    # Always issue a new code so previously shared codes stop working
    if guest_access is None:
        guest_access = TripGuestAccess(trip_id=trip_id)
        db.add(guest_access)

    guest_access.access_code = generate_access_code(db)
    guest_access.pin_hash = hash_password(guest_access_setup.pin)
    guest_access.expires_at = guest_access_setup.expires_at

    db.commit()
    db.refresh(guest_access)

    return guest_access

@setup_router.get("", response_model=GuestAccessResponse)
def get_guest_access(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, ["owner"])

    guest_access = db.query(TripGuestAccess).filter(
        TripGuestAccess.trip_id == trip_id
    ).first()

    if guest_access is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Guest access not set up"
        )

    return guest_access

@setup_router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def revoke_guest_access(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, ["owner"])

    guest_access = db.query(TripGuestAccess).filter(
        TripGuestAccess.trip_id == trip_id
    ).first()

    if guest_access is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Guest access not set up"
        )

    db.delete(guest_access)
    db.commit()
