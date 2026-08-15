from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from models import TripGuestAccess
from schemas imports GuestAccessCreate
from security import create_access_token, verify_password

router = APIRouter(
    prefix="/guest",
    tags=["Guest Access"]
)

@router.post("/access", response_model=GuestToken)
def guest_access(
    guest_access_create: GuestAccessCreate,
    db: Session = Depends(connect_db)
):
    guest_access = db.query(TripGuestAccess).filter(
        TripGuestAccess.access_code == guest_access_create.access_code
    ).first()
    if guest_access is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid credentials"
        )
    if not verify_password(guest_access.pin_hash, guest_access_create.pin):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid credentials"
        )
    token = create_access_token({"sub": str(guest_access.id), "type": "guest", "trip_id": str(guest_access.trip_id)})
    return {"access_token": token, "token_type": "bearer"}