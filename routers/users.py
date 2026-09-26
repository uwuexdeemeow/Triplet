from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import connect_db
from models import User
from schemas import UserResponse, UserPublic, UserUpdate
from security import hash_password
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

    # name, email and password are NOT NULL, so an explicit null means "leave unchanged"
    if update_data.get("email") is not None:
        existing_user = db.query(User).filter(
            func.lower(User.email) == update_data["email"].lower(),
            User.id != current_user.id
        ).first()

        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email is already in use"
            )

        current_user.email = update_data["email"]

    if update_data.get("name") is not None:
        if not update_data["name"].isalnum():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Invalid credentials"
            )

        current_user.name = update_data["name"]

    if "avatar_url" in update_data:
        avatar_url = update_data["avatar_url"]
        current_user.avatar_url = str(avatar_url) if avatar_url is not None else None

    if update_data.get("password") is not None:
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

@router.get("/search", response_model=list[UserPublic])
def search_users(
    q: str = Query(min_length=2, max_length=255),
    db: Session = Depends(connect_db),
    current_user: User = Depends(get_current_user)
):
    query = q.strip().lower()

    # Emails must match exactly so the endpoint can't be used to list everyone's address
    users = (
        db.query(User)
        .filter(
            User.id != current_user.id,
            (func.lower(User.name).startswith(query, autoescape=True)) | (func.lower(User.email) == query)
        )
        .order_by(User.name)
        .limit(20)
        .all()
    )

    return users
