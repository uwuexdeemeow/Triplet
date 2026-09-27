"""
Confirming email addresses: for new accounts, and for switching to a new email.

A link with a random token is emailed; opening it proves the person controls that inbox.
Only then does the account become usable (or the new email take effect), and any trip
invitations sent to that address are attached to the account.
"""
from datetime import datetime, timedelta, timezone

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy.orm import Session

from config import settings
from mailer import send_email
from models import EmailVerificationToken, TripInvitation, User
from security import generate_token, hash_token
from validators import as_utc

def send_verification(db: Session, background_tasks: BackgroundTasks, user: User, email: str, changing: bool = False):
    """Email a confirmation link for `email`, replacing any earlier link. Commits."""
    now = datetime.now(timezone.utc)

    # Only the newest link should work
    db.query(EmailVerificationToken).filter(
        EmailVerificationToken.user_id == user.id,
        EmailVerificationToken.used_at.is_(None)
    ).update({"used_at": now}, synchronize_session=False)

    token = generate_token()
    db.add(EmailVerificationToken(
        user_id=user.id,
        email=email,
        token_hash=hash_token(token),
        expires_at=now + timedelta(hours=settings.EMAIL_VERIFY_EXPIRE_HOURS)
    ))
    db.commit()

    link = f"{settings.APP_URL}/verify-email?token={token}"
    if changing:
        subject = "Confirm your new Triplet email"
        body = (
            f"Hi {user.name},\n\n"
            f"Confirm this address to use it for your Triplet account:\n{link}\n\n"
            f"The link works for {settings.EMAIL_VERIFY_EXPIRE_HOURS} hours. "
            "If you didn't ask for this, you can ignore this email; nothing will change."
        )
    else:
        subject = "Confirm your email for Triplet"
        body = (
            f"Hi {user.name},\n\n"
            f"Welcome to Triplet! Confirm your email to finish signing up:\n{link}\n\n"
            f"The link works for {settings.EMAIL_VERIFY_EXPIRE_HOURS} hours. "
            "If you didn't sign up, you can ignore this email."
        )
    background_tasks.add_task(send_email, email, subject, body)

def confirm(db: Session, token: str) -> User:
    """Use a confirmation link: activate the account, or switch it to its new email. Commits."""
    stored = db.query(EmailVerificationToken).filter(
        EmailVerificationToken.token_hash == hash_token(token)
    ).first()

    if stored is None or stored.used_at is not None or as_utc(stored.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This link has expired or was already used"
        )

    user = db.query(User).filter(User.id == stored.user_id).first()
    now = datetime.now(timezone.utc)

    if stored.email != user.email:
        # Switching to a new address, unless someone else took it in the meantime
        taken = db.query(User).filter(User.email == stored.email, User.id != user.id).first()
        if taken is not None:
            stored.used_at = now
            user.pending_email = None
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="That email is already used by another account"
            )
        user.email = stored.email
        user.pending_email = None

    user.email_verified_at = user.email_verified_at or now
    stored.used_at = now
    attach_invitations(db, user)
    db.commit()
    return user

def mark_verified(db: Session, user: User):
    """The person proved they own the inbox some other way, e.g. a password reset link."""
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now(timezone.utc)
        attach_invitations(db, user)

def attach_invitations(db: Session, user: User):
    """Invitations sent to this email before the account existed now belong to it."""
    waiting = db.query(TripInvitation).filter(
        TripInvitation.email == user.email,
        TripInvitation.user_id.is_(None)
    ).all()

    for invitation in waiting:
        already = db.query(TripInvitation).filter(
            TripInvitation.trip_id == invitation.trip_id,
            TripInvitation.user_id == user.id
        ).first()
        if already is not None:
            # Invited twice (by email and directly): keep the one that exists
            db.delete(invitation)
        else:
            invitation.user_id = user.id
