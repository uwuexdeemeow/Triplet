from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from models import User
from schemas import UserCreate, UserLogin, UserResponse, UserUpdate
from security import hash_password, verify_password, create_access_token
from validators import password_strength
from dependencies import get_current_user

router = APIRouter(
    prefix="/users",
    tags=["User Data"]
)

@router.get("/me", response_model=UserResponse)
def get_me(
    current_user: User = Depends(get_current_user)
):
    return current_user

@router.patch("/me", response_model=UserResponse)
def update_profile(
    user_update: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(connect_db)
):
    if user_update.email:
        current_user.email = user_update.email
    if user_update.name:
        current_user.name = user_update.name
    if user_update.password:
        email_prefix = user_update.email.split('@')[0]  # Extract the part before '@' for additional checks
        user_inputs = [user_update.name.lower(), email_prefix.lower()]
        result = password_strength(user_update.password.lower(), user_inputs)
        if not result["is_valid"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid credentials"
            )
        current_user.password = hash_password(user_update.password)

    db.commit()
    db.refresh(current_user)

    return current_user