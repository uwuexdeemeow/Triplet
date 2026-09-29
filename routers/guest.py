import secrets
import string
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from config import settings
from database import connect_db
from models import Trip, TripMembership, TripGuestAccess, Activity
from schemas import (
    GuestAccessCreate, GuestAccessSetup, GuestAccessUpdate, GuestAccessResponse, GuestToken, GuestLookup,
    TripResponse, ActivityResponse, GuestItineraryResponse
)
from security import create_access_token, decode_access_token, verify_password, hash_password
from dependencies import get_current_guest, get_trip_membership, require_role
import rate_limit
from rate_limit import client_ip
from routers.activities import build_itinerary
from routers.auth import TOKEN_IP_LIMIT, TOKEN_WINDOW
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

GUEST_CODE_LIMIT = 5      # wrong PINs per trip code...
GUEST_IP_LIMIT = 20       # ...and per network address
GUEST_WINDOW = timedelta(minutes=15)
TOO_MANY_GUESSES = "Too many wrong codes. Wait a few minutes and try again."
ACCESS_CODE_LENGTH = 8

def access_response(access: TripGuestAccess) -> GuestAccessResponse:
    # The link opens the website's page for this code, which then asks for the PIN
    return GuestAccessResponse(
        trip_id=access.trip_id,
        access_code=access.access_code,
        expires_at=access.expires_at,
        show_costs=access.show_costs,
        url=f"{settings.APP_URL.rstrip('/')}/shared/{access.access_code}"
    )

def find_active_access(db: Session, access_code: str) -> TripGuestAccess | None:
    """The guest access for a code, unless there is none or it has expired."""
    access = db.query(TripGuestAccess).filter(TripGuestAccess.access_code == access_code).first()
    if access is None or (access.expires_at is not None and as_utc(access.expires_at) <= datetime.now(timezone.utc)):
        return None
    return access

def generate_access_code(db: Session) -> str:
    while True:
        code = "".join(secrets.choice(ACCESS_CODE_ALPHABET) for _ in range(ACCESS_CODE_LENGTH))
        exists = db.query(TripGuestAccess).filter(
            TripGuestAccess.access_code == code
        ).first()
        if exists is None:
            return code

def is_member(request: Request, db: Session, trip_id: int) -> bool:
    """Whether the request carries a signed-in person's token, and that person is on the trip. Never an error."""
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return False
    try:
        payload = decode_access_token(header[7:].strip())
        if payload.get("type") == "guest":
            return False
        user_id = int(payload["sub"])
    except (HTTPException, KeyError, TypeError, ValueError):
        return False
    return db.query(TripMembership).filter(
        TripMembership.trip_id == trip_id, TripMembership.user_id == user_id
    ).first() is not None

@router.get("/lookup/{access_code}", response_model=GuestLookup)
def lookup_guest_code(
    access_code: str,
    request: Request,
    db: Session = Depends(connect_db)
):
    """Which trip a link's code is for, so its page can ask for the PIN by name. The title only."""
    rate_limit.hit(db, f"token-ip:{client_ip(request)}", TOKEN_IP_LIMIT, TOKEN_WINDOW,
                   "Too many requests. Wait a moment and try again.")

    access = find_active_access(db, access_code.strip().upper())
    trip = db.query(Trip).filter(Trip.id == access.trip_id).first() if access is not None else None
    # An unknown code and an expired one look the same, so codes can't be told apart
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This link or code doesn’t work")
    return GuestLookup(title=trip.title, trip_id=trip.id if is_member(request, db, trip.id) else None)

@router.post("/access", response_model=GuestToken)
def guest_access(
    guest_access_create: GuestAccessCreate,
    request: Request,
    db: Session = Depends(connect_db)
):
    # Codes are shown in capitals, but people often type them in lower case
    access_code = guest_access_create.access_code.strip().upper()

    # A 4-digit PIN has only 10,000 options, so only a few wrong guesses per code are allowed
    code_key = f"guest-code:{access_code}"
    ip_key = f"guest-ip:{client_ip(request)}"
    rate_limit.check(db, code_key, GUEST_CODE_LIMIT, GUEST_WINDOW, TOO_MANY_GUESSES)
    rate_limit.check(db, ip_key, GUEST_IP_LIMIT, GUEST_WINDOW, TOO_MANY_GUESSES)

    guest_access = db.query(TripGuestAccess).filter(
        TripGuestAccess.access_code == access_code
    ).first()
    if guest_access is None or not verify_password(guest_access.pin_hash, guest_access_create.pin):
        rate_limit.record(db, code_key, GUEST_WINDOW)
        rate_limit.record(db, ip_key, GUEST_WINDOW)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
    rate_limit.clear(db, code_key)
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
    return {
        "access_token": token,
        "token_type": "bearer",
        "access_code": guest_access.access_code,
        "show_costs": guest_access.show_costs
    }

@router.get("/trip", response_model=TripResponse)
def get_guest_trip(
    db: Session = Depends(connect_db),
    guest: TripGuestAccess = Depends(get_current_guest)
):
    trip = TripResponse.model_validate(db.query(Trip).filter(Trip.id == guest.trip_id).first())
    if not guest.show_costs:
        trip.budget = None
    return trip

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

    shown = [ActivityResponse.model_validate(activity) for activity in activities]
    if not guest.show_costs:
        for activity in shown:
            activity.estimated_cost = None
    return shown

@router.get("/itinerary", response_model=GuestItineraryResponse)
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

    itinerary = GuestItineraryResponse.model_validate(build_itinerary(db, guest.trip_id, activities).model_dump())
    if not guest.show_costs:
        for day in itinerary.days:
            day.estimated_cost = None
            for activity in day.activities:
                activity.estimated_cost = None
    return itinerary

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
    guest_access.show_costs = guest_access_setup.show_costs

    db.commit()
    db.refresh(guest_access)

    return access_response(guest_access)

@setup_router.patch("", response_model=GuestAccessResponse)
def update_guest_access(
    trip_id: int,
    guest_access_update: GuestAccessUpdate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """Show or hide costs without issuing a new code, so links already sent keep working."""
    require_role(membership, ["owner"])

    guest_access = db.query(TripGuestAccess).filter(
        TripGuestAccess.trip_id == trip_id
    ).first()

    if guest_access is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Guest access not set up"
        )

    guest_access.show_costs = guest_access_update.show_costs
    db.commit()
    db.refresh(guest_access)

    return access_response(guest_access)

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

    return access_response(guest_access)

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
