from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session
from config import settings
from database import connect_db
from models import User, RefreshToken, PasswordResetToken
from schemas import UserCreate, UserLogin, UserResponse, Token, RefreshRequest, PasswordResetRequest, PasswordResetConfirm, MessageResponse
from security import hash_password, verify_password, create_access_token, generate_token, hash_token
from validators import password_strength, as_utc
from dependencies import get_current_user
from mailer import send_email

router = APIRouter(
    prefix="/auth",
    tags=["Authentication"]
)

def issue_tokens(db: Session, user: User) -> dict:
    refresh_token = generate_token()

    db.add(RefreshToken(
        user_id=user.id,
        token_hash=hash_token(refresh_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    ))
    db.commit()

    return {
        "access_token": create_access_token({"sub": str(user.id)}),
        "token_type": "access",
        "refresh_token": refresh_token
    }

def revoke_refresh_tokens(db: Session, user_id: int):
    """Sign the user out everywhere. The caller is responsible for committing."""
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.revoked_at.is_(None)
    ).update({"revoked_at": datetime.now(timezone.utc)})

@router.post("/signup", response_model=UserResponse, status_code=201)
def signup(
    user: UserCreate,
    db: Session = Depends(connect_db)
):  
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invalid credentials"
        )
    if not user.name.isalnum():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid credentials"
        )
    email_prefix = user.email.split('@')[0]  # Extract the part before '@' for additional checks
    user_inputs = [user.name.lower(), email_prefix.lower()]
    result = password_strength(user.password.lower(), user_inputs)
    if not result["is_valid"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid credentials"
        )

    hashed_password = hash_password(user.password)
    new_user = User(
        name=user.name,
        email=user.email,
        password=hashed_password
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return new_user

@router.post("/login", response_model=Token)
def login(
    user: UserLogin,
    db: Session = Depends(connect_db)
):
    user_detail = db.query(User).filter(User.email == user.email).first()
    if not user_detail:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Incorrect credentials"
        )
    if not verify_password(user_detail.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Incorrect credentials"
        )
    return issue_tokens(db, user_detail)

@router.post("/refresh", response_model=Token)
def refresh(
    refresh_request: RefreshRequest,
    db: Session = Depends(connect_db)
):
    stored_token = db.query(RefreshToken).filter(
        RefreshToken.token_hash == hash_token(refresh_request.refresh_token)
    ).first()

    if stored_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )

    # Each refresh token is single use. Seeing a revoked one again means it was
    # probably stolen, so sign the user out of every device to be safe.
    if stored_token.revoked_at is not None:
        revoke_refresh_tokens(db, stored_token.user_id)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )

    if as_utc(stored_token.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired"
        )

    # Revoke with a conditional update so two requests racing with the same token can't both win
    revoked = db.query(RefreshToken).filter(
        RefreshToken.id == stored_token.id,
        RefreshToken.revoked_at.is_(None)
    ).update({"revoked_at": datetime.now(timezone.utc)})

    if revoked == 0:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )

    user = db.query(User).filter(User.id == stored_token.user_id).first()

    return issue_tokens(db, user)

@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    refresh_request: RefreshRequest,
    db: Session = Depends(connect_db)
):
    # Always succeeds so clients can safely call it with an old token
    db.query(RefreshToken).filter(
        RefreshToken.token_hash == hash_token(refresh_request.refresh_token),
        RefreshToken.revoked_at.is_(None)
    ).update({"revoked_at": datetime.now(timezone.utc)})
    db.commit()

@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
def logout_all(
    db: Session = Depends(connect_db),
    current_user: User = Depends(get_current_user)
):
    revoke_refresh_tokens(db, current_user.id)
    db.commit()

@router.post("/password-reset/request", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED)
def request_password_reset(
    reset_request: PasswordResetRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(connect_db)
):
    # Same response whether or not the email exists, so it can't be used to find accounts
    response = {"detail": "If that email is registered, a reset link has been sent"}

    user = db.query(User).filter(User.email == reset_request.email).first()
    if user is None:
        return response

    # Only the most recent link should work
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None)
    ).update({"used_at": datetime.now(timezone.utc)})

    token = generate_token()
    db.add(PasswordResetToken(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES)
    ))
    db.commit()

    background_tasks.add_task(
        send_email,
        user.email,
        "Reset your Triplet password",
        f"Hi {user.name},\n\n"
        f"Use this link to reset your password:\n{settings.PASSWORD_RESET_URL}?token={token}\n\n"
        f"The link expires in {settings.PASSWORD_RESET_EXPIRE_MINUTES} minutes. "
        "If you didn't ask for this, you can ignore this email."
    )

    return response

@router.post("/password-reset/confirm", response_model=MessageResponse)
def confirm_password_reset(
    reset_confirm: PasswordResetConfirm,
    db: Session = Depends(connect_db)
):
    reset_token = db.query(PasswordResetToken).filter(
        PasswordResetToken.token_hash == hash_token(reset_confirm.token)
    ).first()

    if (
        reset_token is None
        or reset_token.used_at is not None
        or as_utc(reset_token.expires_at) <= datetime.now(timezone.utc)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset link"
        )

    user = db.query(User).filter(User.id == reset_token.user_id).first()

    email_prefix = user.email.split("@")[0]
    result = password_strength(reset_confirm.new_password.lower(), [user.name.lower(), email_prefix.lower()])
    if not result["is_valid"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid credentials"
        )

    user.password = hash_password(reset_confirm.new_password)
    reset_token.used_at = datetime.now(timezone.utc)
    revoke_refresh_tokens(db, user.id)
    db.commit()

    return {"detail": "Password has been reset"}
