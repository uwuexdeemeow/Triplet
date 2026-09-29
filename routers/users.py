import hashlib
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import connect_db
from models import Trip, TripMembership, User, UserAvatar
from schemas import AccountDelete, CodeRequest, MessageResponse, PasswordSet, UserResponse, UserPublic, UserUpdate
import rate_limit
from rate_limit import client_ip
from security import hash_password, verify_password
from validators import password_strength, clean_name, NAME_ERROR
from dependencies import get_current_user, Pagination
from routers.auth import (
    RESET_CODE_PURPOSE, RESET_EMAIL_LIMIT, RESET_WINDOW, latest_password_code, new_password_code, revoke_refresh_tokens
)
from config import settings
from mailer import send_email
import verification
import security_emails

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
    if (changing_email or changing_password) and not current_user.has_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Set a password first: we'll email you a code to prove it's you"
        )
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
        security_emails.password_changed(background_tasks, current_user.email, current_user.name, "changed")

    db.commit()

    if new_email is not None:
        verification.send_verification(db, background_tasks, current_user, new_email)
    if changing_email:
        # The current inbox hears about it too, whether or not the new address is free
        security_emails.email_change_requested(background_tasks, current_user.email, current_user.name, update_data["email"])

    db.refresh(current_user)
    return current_user

@router.post("/me/password/code", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED)
def send_password_code(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(connect_db)
):
    """
    For accounts made with Google or Apple: email a code to set a first password with. A code
    to the account's inbox, not just a signed-in session, so someone using a phone left
    unlocked can't give themselves a password to the account.
    """
    if current_user.has_password:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have a password. Change it with your current one."
        )
    rate_limit.hit(db, f"reset-email:{current_user.email}", RESET_EMAIL_LIMIT, RESET_WINDOW,
                   "That's a lot of codes. Wait a while, then try again.")

    code = new_password_code(db, current_user)
    background_tasks.add_task(
        send_email,
        current_user.email,
        f"{code} is your code to set a Triplet password",
        f"Hi {current_user.name},\n\n"
        f"Enter this code in Triplet to set a password, so you can also sign in with your email:\n\n    {code}\n\n"
        f"It works for {settings.EMAIL_CODE_EXPIRE_MINUTES} minutes. "
        "If you didn't ask for this, someone may be using your signed-in Triplet account: "
        "don't share the code, and sign out of Triplet on devices you don't recognise."
    )
    return {"detail": "A code is on its way to your email"}

@router.post("/me/password", response_model=UserResponse)
def set_password(
    password_set: PasswordSet,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(connect_db)
):
    """Set a first password with the emailed code. Signing in with Google or Apple keeps working."""
    if current_user.has_password:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have a password. Change it with your current one."
        )
    row = latest_password_code(db, current_user.id)
    verification.check_code(db, row, RESET_CODE_PURPOSE, password_set.code)

    email_prefix = current_user.email.split("@")[0]
    result = password_strength(password_set.password.lower(), [current_user.name.lower(), email_prefix.lower()])
    if not result["is_valid"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid credentials"
        )

    current_user.password = hash_password(password_set.password)
    current_user.has_password = True
    row.used_at = datetime.now(timezone.utc)
    db.commit()
    security_emails.password_changed(background_tasks, current_user.email, current_user.name, "set")
    db.refresh(current_user)
    return current_user

@router.post("/me/email/verify", response_model=UserResponse)
def verify_new_email(
    code_request: CodeRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(connect_db)
):
    """Enter the code sent to a new email address; the account switches to it."""
    rate_limit.hit(db, f"token-ip:{client_ip(request)}", 60, timedelta(minutes=5),
                   "Too many requests. Wait a moment and try again.")
    user = verification.confirm_new_email_code(db, current_user, code_request.code, background_tasks)
    db.refresh(user)
    return user

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

    # Trips aren't owned by a user row, so tidy them up here: a trip only this person was on
    # goes with them, and a trip they owned alone passes to whoever has been on it longest
    for membership in db.query(TripMembership).filter(TripMembership.user_id == current_user.id).all():
        others = (
            db.query(TripMembership)
            .filter(TripMembership.trip_id == membership.trip_id, TripMembership.user_id != current_user.id)
            .order_by(TripMembership.id)
            .all()
        )
        if not others:
            db.delete(db.get(Trip, membership.trip_id))
        elif membership.role == "owner" and not any(other.role == "owner" for other in others):
            others[0].role = "owner"

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
