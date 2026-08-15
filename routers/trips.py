from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from models import User, Trip, TripMembership
from schemas import UserCreate, UserLogin, UserResponse, TripCreate, TripResponse
from security import hash_password, verify_password, create_access_token
from validators import password_strength
from dependencies import get_current_user

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
        start_date=trip_create.start_date,
        end_date=trip_create.end_date
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

@router.get("", response_model=TripResponse)