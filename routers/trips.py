from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from models import User, Trip, TripMembership
from schemas import TripCreate, TripResponse, TripUpdate
from dependencies import get_current_user, get_trip_membership, require_role, EDITOR_ROLES

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

@router.get("", response_model=list[TripResponse])
def get_trips(
    db: Session = Depends(connect_db),
    current_user: User = Depends(get_current_user)
):
    trips = (
        db.query(Trip)
        .join(TripMembership, TripMembership.trip_id == Trip.id)
        .filter(TripMembership.user_id == current_user.id)
        .order_by(Trip.start_date)
        .all()
    )

    return trips

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
