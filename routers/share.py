import secrets
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from config import settings
from database import connect_db
from models import Trip, TripMembership, TripShareLink, Activity
from schemas import ShareLinkResponse, SharedActivity, SharedDay, SharedTrip
from dependencies import get_trip_membership, require_role
import rate_limit
from rate_limit import client_ip
from routers.activities import build_itinerary
from routers.auth import TOKEN_IP_LIMIT, TOKEN_WINDOW

# Owner-facing endpoints for a trip's read-only link
setup_router = APIRouter(
    prefix="/trips/{trip_id}/share-link",
    tags=["Share Link"]
)

# The page anyone with the link opens, signed in or not
router = APIRouter(
    prefix="/shared",
    tags=["Share Link"]
)

NOT_FOUND = "This link doesn't work. It may have been turned off or replaced."

def link_response(link: TripShareLink) -> ShareLinkResponse:
    # The website's address, so a link sent to a phone opens in its browser
    return ShareLinkResponse(
        token=link.token,
        url=f"{settings.APP_URL.rstrip('/')}/shared/{link.token}",
        created_at=link.created_at
    )

def find_link(db: Session, trip_id: int) -> TripShareLink | None:
    return db.query(TripShareLink).filter(TripShareLink.trip_id == trip_id).first()

@setup_router.put("", response_model=ShareLinkResponse)
def create_share_link(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, ["owner"])

    link = find_link(db, trip_id)
    if link is None:
        link = TripShareLink(trip_id=trip_id)
        db.add(link)

    # Always issue a new token so a link shared earlier stops working
    link.token = secrets.token_urlsafe(16)
    db.commit()
    db.refresh(link)
    return link_response(link)

@setup_router.get("", response_model=ShareLinkResponse)
def get_share_link(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, ["owner"])

    link = find_link(db, trip_id)
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No share link")
    return link_response(link)

@setup_router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def turn_off_share_link(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, ["owner"])

    link = find_link(db, trip_id)
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No share link")
    db.delete(link)
    db.commit()

@router.get("/{token}", response_model=SharedTrip)
def get_shared_trip(
    token: str,
    request: Request,
    db: Session = Depends(connect_db)
):
    """The plan only: names, places, dates and times. No costs, budget, people or saved posts."""
    # Tokens are long and random, but nothing else stops someone trying them one after another
    rate_limit.hit(db, f"token-ip:{client_ip(request)}", TOKEN_IP_LIMIT, TOKEN_WINDOW,
                   "Too many requests. Wait a moment and try again.")

    link = db.query(TripShareLink).filter(TripShareLink.token == token).first()
    trip = db.query(Trip).filter(Trip.id == link.trip_id).first() if link is not None else None
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)

    activities = (
        db.query(Activity)
        .filter(Activity.trip_id == trip.id)
        .order_by(Activity.start_time, Activity.id)
        .all()
    )
    itinerary = build_itinerary(db, trip.id, activities)

    return SharedTrip(
        title=trip.title,
        destination=trip.destination,
        destinations=[place["name"] for place in trip.destinations or []],
        start_date=trip.start_date,
        end_date=trip.end_date,
        days=[
            SharedDay(
                date=day.date,
                weather=day.weather,
                activities=[SharedActivity.model_validate(activity, from_attributes=True) for activity in day.activities]
            )
            for day in itinerary.days
        ]
    )
