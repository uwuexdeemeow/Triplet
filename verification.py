"""
Confirming email addresses: for new accounts, and for switching to a new email.

A six-digit code is emailed (see codes.py); entering it proves the person controls that inbox.
Only then is the account created (or the new email takes effect), and any trip invitations
sent to that address are attached to the account. Until then a sign-up waits in
pending_signups, so nobody can hold an address they don't own. Links emailed before codes
replaced them still work until they expire.
"""
from datetime import datetime, timedelta, timezone

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy.orm import Session

import codes
from config import settings
from mailer import send_email
from models import EmailVerificationToken, PendingSignup, TripInvitation, User
from security import generate_token, hash_password, hash_token
from validators import as_utc

CODE_PURPOSE = "verify-email"
SIGNUP_CODE_PURPOSE = "signup"
# How long a sign-up can wait for its code (asking for a new code within this keeps it going)
PENDING_SIGNUP_LIFETIME = timedelta(hours=24)

def start_signup(db: Session, background_tasks: BackgroundTasks, name: str, email: str, password: str) -> str:
    """
    Keep a sign-up until its emailed code is entered, and email that code. Commits.

    Returns the token the sign-up screen sends back with the code.
    """
    now = datetime.now(timezone.utc)
    # Tidy away sign-ups nobody finished
    db.query(PendingSignup).filter(
        PendingSignup.created_at < now - PENDING_SIGNUP_LIFETIME
    ).delete(synchronize_session=False)

    signup_token = generate_token()
    pending = PendingSignup(
        email=email,
        name=name,
        password=hash_password(password),
        signup_token_hash=hash_token(signup_token),
        # A random placeholder until the row has the id its code's hash is keyed on
        token_hash=hash_token(generate_token()),
        expires_at=now
    )
    db.add(pending)
    db.flush()
    _email_signup_code(db, background_tasks, pending)
    return signup_token

def find_signup(db: Session, signup_token: str) -> PendingSignup | None:
    pending = db.query(PendingSignup).filter(
        PendingSignup.signup_token_hash == hash_token(signup_token)
    ).first()
    if pending is None or as_utc(pending.created_at) <= datetime.now(timezone.utc) - PENDING_SIGNUP_LIFETIME:
        return None
    return pending

def resend_signup_code(db: Session, background_tasks: BackgroundTasks, pending: PendingSignup):
    """Email a new code for a waiting sign-up; the old one stops working. Commits."""
    _email_signup_code(db, background_tasks, pending)

def _email_signup_code(db: Session, background_tasks: BackgroundTasks, pending: PendingSignup):
    code = codes.new_code()
    pending.token_hash = codes.code_hash(SIGNUP_CODE_PURPOSE, pending.id, code)
    pending.expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.EMAIL_CODE_EXPIRE_MINUTES)
    pending.attempts = 0
    pending.used_at = None
    db.commit()

    background_tasks.add_task(
        send_email,
        pending.email,
        f"{code} is your Triplet code",
        f"Hi {pending.name},\n\n"
        f"Welcome to Triplet! Enter this code to finish signing up:\n\n    {code}\n\n"
        f"It works for {settings.EMAIL_CODE_EXPIRE_MINUTES} minutes. If you didn't sign up, you can ignore this email."
    )

def confirm_signup(db: Session, signup_token: str, code: str) -> User:
    """Enter the code from a sign-up email: the account is created, already confirmed. Commits."""
    pending = find_signup(db, signup_token)
    check_code(db, pending, SIGNUP_CODE_PURPOSE, code)

    # Someone else with the same address finished signing up first
    if db.query(User).filter(User.email == pending.email).first() is not None:
        db.delete(pending)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email already has an account. Log in instead."
        )

    user = User(
        name=pending.name,
        email=pending.email,
        password=pending.password,
        email_verified_at=datetime.now(timezone.utc)
    )
    db.add(user)
    # Any other sign-ups waiting on this address are now moot
    db.query(PendingSignup).filter(PendingSignup.email == pending.email).delete(synchronize_session=False)
    db.flush()
    attach_invitations(db, user)
    db.commit()
    db.refresh(user)
    return user

def send_verification(db: Session, background_tasks: BackgroundTasks, user: User, email: str):
    """Email a code to confirm switching the account to `email`, replacing any earlier one. Commits."""
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
    background_tasks.add_task(
        send_email,
        email,
        f"{code} is your code to confirm your new Triplet email",
        f"Hi {user.name},\n\n"
        f"Enter this code in Triplet to use this address for your account:\n\n    {code}\n\n"
        f"It works for {minutes} minutes. If you didn't ask for this, you can ignore this email; nothing will change."
    )

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

def confirm_new_email_code(db: Session, user: User, code: str) -> User:
    """Enter the code sent to a new email address: the account switches to it. Commits."""
    row = latest_code(db, user.id, user.pending_email) if user.pending_email else None
    check_code(db, row, CODE_PURPOSE, code)
    return _apply(db, row, user)

def confirm(db: Session, token: str) -> User:
    """Use a confirmation link from before codes to switch the account's email. Commits."""
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
