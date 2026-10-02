from collections import defaultdict
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session
import avatars
import currencies
import currency_change
import destinations as destination_lookup
import exchange_rates
import rate_limit
from database import connect_db
from models import Activity, Expense, SavedLink, User, Trip, TripCover, TripMembership
from photon_lookup import PhotonError
from schemas import CurrencyChange, CurrencyChangeResponse, CurrencySuggestion, DestinationSuggestion, TripCreate, TripAppearance, TripMemberPreview, TripResponse, TripSummaryResponse, TripUpdate
from dependencies import get_current_user, get_trip_membership, require_role, EDITOR_ROLES, Pagination
from routers.users import AVATAR_MAX_BYTES, avatar_content_type

router = APIRouter(
    prefix="/trips",
    tags=["Trips"]
)

@router.post("", response_model=TripResponse, status_code=201)
def create_trip(
    trip_create: TripCreate,
    db: Session = Depends(connect_db),
    current_user: User = Depends(get_current_user)
):
    # Places typed without picking a suggestion are each looked up, which counts as a search
    unpinned = sum(1 for place in trip_create.destinations if place.latitude is None or place.longitude is None)
    rate_limit.limit_lookups(db, current_user.id, unpinned)
    places = destination_lookup.fill_in([place.model_dump() for place in trip_create.destinations])
    trip = Trip(
        title=trip_create.title,
        description=trip_create.description,
        destination=destination_lookup.summary(places) if places else trip_create.destination.strip(),
        destinations=places,
        start_date=trip_create.start_date,
        end_date=trip_create.end_date,
        budget=trip_create.budget,
        currency=trip_create.currency.upper()
    )
    db.add(trip)
    db.flush()

    membership = TripMembership(
        user_id=current_user.id,
        trip_id=trip.id,
        role="owner"
    )

    db.add(membership)
    db.commit()
    db.refresh(trip)

    return trip

# How many people to send for the avatars on each trip card
MEMBER_PREVIEW = 4

@router.get("", response_model=list[TripSummaryResponse])
def get_trips(
    db: Session = Depends(connect_db),
    current_user: User = Depends(get_current_user),
    pagination: Pagination = Depends()
):
    trips = (
        db.query(Trip)
        .join(TripMembership, TripMembership.trip_id == Trip.id)
        .filter(TripMembership.user_id == current_user.id)
        .order_by(Trip.start_date, Trip.id)
        .limit(pagination.limit)
        .offset(pagination.offset)
        .all()
    )

    return summarise(db, trips)

def summarise(db: Session, trips: list[Trip]) -> list[TripSummaryResponse]:
    """Counts for each trip card, in one query per kind rather than per trip."""
    ids = [trip.id for trip in trips]
    if not ids:
        return []

    def counts(column, *filters):
        return dict(db.query(column, func.count()).filter(column.in_(ids), *filters).group_by(column).all())

    plans = counts(Activity.trip_id)
    saved = counts(SavedLink.trip_id)
    member_counts = counts(TripMembership.trip_id)
    spent = dict(
        db.query(Expense.trip_id, func.sum(Expense.amount))
        .filter(Expense.trip_id.in_(ids))
        .group_by(Expense.trip_id)
        .all()
    )

    previews = defaultdict(list)
    rows = (
        db.query(TripMembership.trip_id, User.id, User.name, User.avatar_url, User.avatar_buddy)
        .join(User, User.id == TripMembership.user_id)
        .filter(TripMembership.trip_id.in_(ids))
        .order_by(TripMembership.trip_id, TripMembership.id)
        .all()
    )
    for trip_id, user_id, name, avatar_url, avatar_buddy in rows:
        if len(previews[trip_id]) < MEMBER_PREVIEW:
            previews[trip_id].append(TripMemberPreview(user_id=user_id, name=name, avatar_url=avatar_url, avatar_buddy=avatar_buddy))

    return [
        TripSummaryResponse(
            **TripResponse.model_validate(trip).model_dump(),
            plan_count=plans.get(trip.id, 0),
            saved_count=saved.get(trip.id, 0),
            spent=float(spent.get(trip.id) or 0),
            member_count=member_counts.get(trip.id, 0),
            members=previews[trip.id],
        )
        for trip in trips
    ]

# Declared before /{trip_id} so "destinations" and "currency" aren't read as trip ids
@router.get("/destinations", response_model=list[DestinationSuggestion])
def suggest_destinations(
    q: str = Query(min_length=2, max_length=120),
    db: Session = Depends(connect_db),
    current_user: User = Depends(get_current_user)
):
    """Cities, regions and countries matching what's typed so far, for a new trip's destinations."""
    rate_limit.limit_lookups(db, current_user.id)
    try:
        return destination_lookup.suggest(q)
    except PhotonError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Place suggestions aren't available right now. Type the name and press Enter."
        )

@router.get("/currency", response_model=CurrencySuggestion)
def suggest_currency(
    destination: str = Query(min_length=1, max_length=255),
    db: Session = Depends(connect_db),
    current_user: User = Depends(get_current_user)
):
    """The currency a new trip to `destination` most likely uses, e.g. JPY for "Tokyo"."""
    rate_limit.limit_lookups(db, current_user.id)
    return {"currency": currencies.for_destination(destination)}

@router.get("/{trip_id}", response_model=TripResponse)
def get_trip(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    trip = db.query(Trip).filter(
        Trip.id == trip_id
    ).first()

    if trip is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found"
        )
    return trip

@router.patch("/{trip_id}", response_model=TripResponse)
def update_trips(
    trip_id: int,
    trip_update: TripUpdate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    trip = db.query(Trip).filter(
        Trip.id == trip_id
    ).first()

    if trip is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found"
        )

    # Determine what the dates will be after the update
    new_start_date = (
        trip_update.start_date
        if trip_update.start_date is not None
        else trip.start_date
    )

    new_end_date = (
        trip_update.end_date
        if trip_update.end_date is not None
        else trip.end_date
    )

    if new_end_date < new_start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="End date cannot be before start date"
        )

    update_data = trip_update.model_dump(
        exclude_unset=True
    )

    # The places and the one-line name go together
    if update_data.get("destinations"):
        unpinned = sum(1 for place in update_data["destinations"] if place.get("latitude") is None or place.get("longitude") is None)
        rate_limit.limit_lookups(db, membership.user_id, unpinned)
        update_data["destinations"] = destination_lookup.fill_in(update_data["destinations"])
        update_data["destination"] = destination_lookup.summary(update_data["destinations"])
    else:
        update_data.pop("destinations", None)
        if update_data.get("destination"):
            update_data["destinations"] = []

    # A different currency converts the trip's money (older app versions can't just relabel it)
    new_currency = update_data.pop("currency", None)
    if new_currency is not None and new_currency.upper() != trip.currency:
        currency_change.convert_trip(db, trip, new_currency, exchange_rates.usd_rates())

    # These columns are NOT NULL, so an explicit null means "leave unchanged"
    required_fields = ["title", "destination", "start_date", "end_date"]

    for field, value in update_data.items():
        if value is None and field in required_fields:
            continue
        setattr(trip, field, value)

    db.commit()
    db.refresh(trip)

    return trip

@router.post("/{trip_id}/currency", response_model=CurrencyChangeResponse)
def change_currency(
    trip_id: int,
    change: CurrencyChange,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """Switch the trip to another currency, converting its budget, expenses, plan costs and paybacks at today's rate."""
    require_role(membership, EDITOR_ROLES)

    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")

    old_currency = trip.currency
    rate = currency_change.convert_trip(db, trip, change.currency, exchange_rates.usd_rates())
    db.commit()
    db.refresh(trip)

    return CurrencyChangeResponse(trip=trip, rate=rate, old_currency=old_currency)

@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip(
    trip_id:int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, ["owner"])

    trip = db.query(Trip).filter(
        Trip.id == trip_id
    ).first()

    if trip is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found"
        )

    db.delete(trip)
    db.commit()

def editable_trip(db: Session, trip_id: int, membership: TripMembership) -> Trip:
    require_role(membership, EDITOR_ROLES)
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found"
        )
    return trip

@router.put("/{trip_id}/appearance", response_model=TripResponse)
def set_appearance(
    trip_id: int,
    trip_appearance: TripAppearance,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """How the trip looks to everyone in it. Anyone who can edit the trip can change it."""
    trip = editable_trip(db, trip_id, membership)
    trip.appearance = trip_appearance.model_dump()
    db.commit()
    db.refresh(trip)
    return trip

@router.put("/{trip_id}/cover", response_model=TripResponse)
async def upload_cover(
    trip_id: int,
    file: UploadFile,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """The photo for the "Your photo" style."""
    trip = editable_trip(db, trip_id, membership)

    data = await file.read(AVATAR_MAX_BYTES + 1)
    if len(data) > AVATAR_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="That photo is too big. Pick one under 900 KB."
        )
    content_type = avatar_content_type(data)
    if content_type is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Use a JPEG, PNG or WebP photo"
        )

    cover = db.get(TripCover, trip.id)
    if cover is None:
        cover = TripCover(trip_id=trip.id)
        db.add(cover)
    cover.content_type = content_type
    cover.data = data
    cover.updated_at = datetime.now(timezone.utc)
    trip.cover_url = avatars.cover_path(trip.id, avatars.photo_version(data))

    db.commit()
    db.refresh(trip)
    return trip

@router.delete("/{trip_id}/cover", response_model=TripResponse)
def delete_cover(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    trip = editable_trip(db, trip_id, membership)
    cover = db.get(TripCover, trip.id)
    if cover is not None:
        db.delete(cover)
    trip.cover_url = None
    db.commit()
    db.refresh(trip)
    return trip

# No sign-in, like profile photos, so image views and share-link guests can load it, but only
# with the signed address of the current photo
@router.get("/{trip_id}/cover")
def get_cover(
    trip_id: int,
    v: str = Query(default="", max_length=64),
    sig: str = Query(default="", max_length=64),
    db: Session = Depends(connect_db)
):
    cover = db.get(TripCover, trip_id)
    if cover is None or not avatars.cover_valid(trip_id, v, sig, cover.data):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No photo"
        )
    return Response(
        content=cover.data,
        media_type=cover.content_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"}
    )
