import hashlib
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import connect_db
from models import TripMembership, User, UserAvatar
from schemas import AccountDelete, UserResponse, UserPublic, UserUpdate
from security import hash_password, verify_password
from validators import password_strength, clean_name, NAME_ERROR
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
        name = clean_name(update_data["name"])
        if name is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=NAME_ERROR
            )

        current_user.name = name

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

# Under the API's 1 MB request limit; the app sends about 100 KB
AVATAR_MAX_BYTES = 900 * 1024

def avatar_content_type(data: bytes) -> str | None:
    # Only formats every phone and browser can show
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None

@router.put("/me/avatar", response_model=UserResponse)
async def upload_avatar(
    file: UploadFile,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(connect_db)
):
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

    avatar = db.get(UserAvatar, current_user.id)
    if avatar is None:
        avatar = UserAvatar(user_id=current_user.id)
        db.add(avatar)
    avatar.content_type = content_type
    avatar.data = data
    avatar.updated_at = datetime.now(timezone.utc)

    # The version changes with every upload, so apps don't keep showing a cached old photo
    version = hashlib.sha256(data).hexdigest()[:12]
    current_user.avatar_url = f"/users/{current_user.id}/avatar?v={version}"

    db.commit()
    db.refresh(current_user)

    return current_user

@router.delete("/me/avatar", response_model=UserResponse)
def delete_avatar(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(connect_db)
):
    avatar = db.get(UserAvatar, current_user.id)
    if avatar is not None:
        db.delete(avatar)
    current_user.avatar_url = None

    db.commit()
    db.refresh(current_user)

    return current_user

# Public, so image views can load it without a token; the URL changes when the photo does
@router.get("/{user_id}/avatar")
def get_avatar(
    user_id: int,
    db: Session = Depends(connect_db)
):
    avatar = db.get(UserAvatar, user_id)
    if avatar is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No photo"
        )

    return Response(
        content=avatar.data,
        media_type=avatar.content_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"}
    )

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
