from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import connect_db
from models import TripMembership, User
from schemas import AccountDelete, UserResponse, UserPublic, UserUpdate
from security import hash_password, verify_password
from validators import password_strength
from dependencies import get_current_user, Pagination
from routers.auth import revoke_refresh_tokens
import verification

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
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(connect_db)
):
    update_data = user_update.model_dump(exclude_unset=True)
    update_data.pop("current_password", None)

    # Taking over an account needs the current password, not just a signed-in session
    changing_email = update_data.get("email") is not None and update_data["email"].lower() != current_user.email.lower()
    changing_password = update_data.get("password") is not None
    if (changing_email or changing_password) and not (
        user_update.current_password and verify_password(current_user.password, user_update.current_password)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Enter your current password to change your email or password"
        )

    # name, email and password are NOT NULL, so an explicit null means "leave unchanged".
    # A new email only takes effect once it's confirmed from its own inbox, so nobody can
    # claim an address they don't own. If another account already uses it, the answer looks
    # the same (no link is sent), so this can't be used to find out who has an account.
    new_email = None
    if changing_email:
        taken = db.query(User).filter(
            func.lower(User.email) == update_data["email"].lower(),
            User.id != current_user.id
        ).first()
        current_user.pending_email = update_data["email"]
        if taken is None:
            new_email = update_data["email"]

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
        # Sign out other devices after a password change
        revoke_refresh_tokens(db, current_user.id)

    db.commit()

    if new_email is not None:
        verification.send_verification(db, background_tasks, current_user, new_email, changing=True)

    db.refresh(current_user)
    return current_user

@router.delete("/me", status_code=204)
def delete_user(
    confirmation: AccountDelete,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(connect_db)
):
    # Deleting everything can't be undone, so ask for the password first
    if not verify_password(current_user.password, confirmation.password):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="That password isn't right"
        )

    db.delete(current_user)
    db.commit()

@router.get("/search", response_model=list[UserPublic])
def search_users(
    q: str = Query(min_length=2, max_length=255),
    db: Session = Depends(connect_db),
    current_user: User = Depends(get_current_user),
    pagination: Pagination = Depends()
):
    query = q.strip().lower()

    # Only people you already share a trip with, found by name, so this can't be used to list
    # everyone on Triplet or to check whether an email has an account
    my_trips = db.query(TripMembership.trip_id).filter(TripMembership.user_id == current_user.id)
    co_travellers = db.query(TripMembership.user_id).filter(TripMembership.trip_id.in_(my_trips))

    users = (
        db.query(User)
        .filter(
            User.id != current_user.id,
            User.id.in_(co_travellers),
            func.lower(User.name).startswith(query, autoescape=True)
        )
        .order_by(User.name, User.id)
        .limit(pagination.limit)
        .offset(pagination.offset)
        .all()
    )

    return users
