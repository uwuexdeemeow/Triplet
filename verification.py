"""
Confirming email addresses: for new accounts, and for switching to a new email.

A six-digit code is emailed (see codes.py); entering it proves the person controls that inbox.
Only then does the account become usable (or the new email take effect), and any trip
invitations sent to that address are attached to the account. Links emailed before codes
replaced them still work until they expire.
"""
from datetime import datetime, timedelta, timezone

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy.orm import Session

import codes
from config import settings
from mailer import send_email
from models import EmailVerificationToken, TripInvitation, User
from security import generate_token, hash_token
from validators import as_utc

CODE_PURPOSE = "verify-email"

def send_verification(db: Session, background_tasks: BackgroundTasks, user: User, email: str, changing: bool = False):
    """Email a confirmation code for `email`, replacing any earlier one. Commits."""
    now = datetime.now(timezone.utc)

    # Only the newest code should work
    db.query(EmailVerificationToken).filter(
        EmailVerificationToken.user_id == user.id,
        EmailVerificationToken.used_at.is_(None)
    ).update({"used_at": now}, synchronize_session=False)

    code = codes.new_code()
    row = EmailVerificationToken(
        user_id=user.id,
        email=email,
        # A random placeholder until the row has the id its code's hash is keyed on
        token_hash=hash_token(generate_token()),
        expires_at=now + timedelta(minutes=settings.EMAIL_CODE_EXPIRE_MINUTES)
    )
    db.add(row)
    db.flush()
    row.token_hash = codes.code_hash(CODE_PURPOSE, row.id, code)
    db.commit()

    minutes = settings.EMAIL_CODE_EXPIRE_MINUTES
    if changing:
        subject = f"{code} is your code to confirm your new Triplet email"
        body = (
            f"Hi {user.name},\n\n"
            f"Enter this code in Triplet to use this address for your account:\n\n    {code}\n\n"
            f"It works for {minutes} minutes. If you didn't ask for this, you can ignore this email; nothing will change."
        )
    else:
        subject = f"{code} is your Triplet code"
        body = (
            f"Hi {user.name},\n\n"
            f"Welcome to Triplet! Enter this code to finish signing up:\n\n    {code}\n\n"
            f"It works for {minutes} minutes. If you didn't sign up, you can ignore this email."
        )
    background_tasks.add_task(send_email, email, subject, body)

def check_code(db: Session, row, purpose: str, code: str):
    """
    Check an emailed code against its row, counting wrong tries. Commits on a wrong code.
    Raises a 400 that's safe to show when the code is wrong, expired or used up.
    """
    now = datetime.now(timezone.utc)
    if (
        row is None
        or row.used_at is not None
        or as_utc(row.expires_at) <= now
        or row.attempts >= codes.MAX_ATTEMPTS
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That code has expired. Ask for a new one."
        )
    if not codes.matches(purpose, row.id, code, row.token_hash):
        row.attempts += 1
        left = codes.MAX_ATTEMPTS - row.attempts
        if left <= 0:
            row.used_at = now
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"That code isn't right. {left} {'try' if left == 1 else 'tries'} left."
            if left > 0 else "That code isn't right, and it's now used up. Ask for a new one."
        )

def latest_code(db: Session, user_id: int, email: str) -> EmailVerificationToken | None:
    return (
        db.query(EmailVerificationToken)
        .filter(
            EmailVerificationToken.user_id == user_id,
            EmailVerificationToken.email == email,
            EmailVerificationToken.used_at.is_(None)
        )
        .order_by(EmailVerificationToken.id.desc())
        .first()
    )

def confirm_signup_code(db: Session, email: str, code: str) -> User:
    """Enter the code from a sign-up email: the account becomes usable. Commits."""
    user = db.query(User).filter(User.email == email).first()
    row = latest_code(db, user.id, email) if user is not None and user.email_verified_at is None else None
    check_code(db, row, CODE_PURPOSE, code)
    return _apply(db, row, user)

def confirm_new_email_code(db: Session, user: User, code: str) -> User:
    """Enter the code sent to a new email address: the account switches to it. Commits."""
    row = latest_code(db, user.id, user.pending_email) if user.pending_email else None
    check_code(db, row, CODE_PURPOSE, code)
    return _apply(db, row, user)

def confirm(db: Session, token: str) -> User:
    """Use a confirmation link from before codes: activate the account, or switch its email. Commits."""
    stored = db.query(EmailVerificationToken).filter(
        EmailVerificationToken.token_hash == hash_token(token)
    ).first()

    if stored is None or stored.used_at is not None or as_utc(stored.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This link has expired or was already used"
        )

    user = db.query(User).filter(User.id == stored.user_id).first()
    return _apply(db, stored, user)

def _apply(db: Session, stored: EmailVerificationToken, user: User) -> User:
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
    """The person proved they own the inbox some other way, e.g. a password reset code."""
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
