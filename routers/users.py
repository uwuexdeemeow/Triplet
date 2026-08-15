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
    update_data = user_update.model_dump(exclude_unset=True)
    if "email" in update_data:
        current_user.email = update_data["email"]

    if "name" in update_data:
        current_user.name = update_data["name"]

    if "password" in update_data:
        email_prefix = current_user.email.split("@")[0]

        user_inputs = [
            current_user.name.lower(),
            email_prefix.lower()
        ]

        result = password_strength(
            update_data["password"].lower(),
            user_inputs
        )

        if not result["is_valid"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid credentials"
            )
        current_user.password = hash_password(update_data["password"])

    db.commit()
    db.refresh(current_user)

    return current_user

@router.delete("/me", status_code=204)
def delete_user(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(connect_db)
):
    db.delete(current_user)
    db.commit()