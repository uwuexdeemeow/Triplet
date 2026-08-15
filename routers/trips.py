from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from models import User
from schemas import UserCreate, UserLogin, UserResponse, TripCreate, TripResponse
from security import hash_password, verify_password, create_access_token
from validators import password_strength

router = APIRouter(
    prefix="/trips",
    tags=["Trips"]
)

@router.post("", response_model=TripResponse)
def create_trip(
    trip_create: TripCreate,
    db: Session = Depends(connect_db),
    current_user: User = Depends(get_current_user)
):
    trip = Trip(
        name=trip_create.name,
        description=trip_create.description,
        user_id=current_user.id,
        start_date=trip_create.start_date,
        end_date=trip_create.end_date
    )
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return trip

@router.get("", response_model=TripResponse)