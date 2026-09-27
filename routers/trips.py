from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import connect_db
from models import Activity, Expense, SavedLink, User, Trip, TripMembership
from schemas import TripCreate, TripMemberPreview, TripResponse, TripSummaryResponse, TripUpdate
from dependencies import get_current_user, get_trip_membership, require_role, EDITOR_ROLES, Pagination

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
    trip = Trip(
        title=trip_create.title,
        description=trip_create.description,
        destination=trip_create.destination,
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
        db.query(TripMembership.trip_id, User.id, User.name)
        .join(User, User.id == TripMembership.user_id)
        .filter(TripMembership.trip_id.in_(ids))
        .order_by(TripMembership.trip_id, TripMembership.id)
        .all()
    )
    for trip_id, user_id, name in rows:
        if len(previews[trip_id]) < MEMBER_PREVIEW:
            previews[trip_id].append(TripMemberPreview(user_id=user_id, name=name))

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

    # These columns are NOT NULL, so an explicit null means "leave unchanged"
    required_fields = ["title", "destination", "start_date", "end_date", "currency"]

    for field, value in update_data.items():
        if value is None and field in required_fields:
            continue
        if field == "currency":
            value = value.upper()
        setattr(trip, field, value)

    db.commit()
    db.refresh(trip)

    return trip

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
