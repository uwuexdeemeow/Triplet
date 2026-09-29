import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from config import settings
from database import connect_db
from models import User, RefreshToken, PasswordResetToken, PendingSignup, UserIdentity
from schemas import (
    UserCreate, UserLogin, Token, RefreshRequest, PasswordResetRequest, PasswordResetConfirm, MessageResponse,
    VerifyEmailRequest, ResendVerificationRequest, VerifyCodeRequest, SignupResponse, SocialLoginRequest
)
import codes
from security import hash_password, verify_password, create_access_token, generate_token, hash_token
from validators import password_strength, as_utc, clean_name, NAME_ERROR
from dependencies import get_current_user
from mailer import send_email
import verification
import rate_limit
import social_login
from rate_limit import client_ip

# Says why an email wasn't sent; the API can't, since it never reveals which emails have accounts
logger = logging.getLogger("triplet.auth")

router = APIRouter(
    prefix="/auth",
    tags=["Authentication"]
)

# How much guessing each endpoint tolerates before answering 429 Too Many Requests
# Wrong passwords are counted per email on each network, so someone guessing at your account
# only locks out their own network, never you. The per-email ceiling across all networks is
# much higher: it only stops guessing spread over many networks.
LOGIN_EMAIL_IP_LIMIT = 5       # failed sign-ins for one email from one network...
LOGIN_IP_LIMIT = 30            # ...for any email from one network...
LOGIN_EMAIL_LIMIT = 100        # ...and for one email from everywhere
LOGIN_WINDOW = timedelta(minutes=15)
LOGIN_EMAIL_WINDOW = timedelta(hours=1)
SIGNUP_IP_LIMIT = 5
SIGNUP_WINDOW = timedelta(hours=1)
RESET_EMAIL_LIMIT = 3          # reset emails to one address
RESET_IP_LIMIT = 10
RESET_WINDOW = timedelta(hours=1)
TOKEN_IP_LIMIT = 60            # refreshes and reset-link checks
TOKEN_WINDOW = timedelta(minutes=5)

VERIFY_EMAIL_LIMIT = 3         # confirmation or "you already have an account" emails per address
VERIFY_WINDOW = timedelta(hours=1)

RESET_CODE_PURPOSE = "reset-password"

TOO_MANY_LOGINS ="Too many sign-in attempts. Wait a few minutes and try again."
# The same answer whether or not the email already has an account, so sign-up can't be used to find accounts
CHECK_EMAIL = "Check your email to finish signing up"

# A real Argon2 hash to check against when the email has no account, so a wrong email takes
# as long as a wrong password and response times don't reveal who has an account
DUMMY_PASSWORD_HASH = hash_password("not-a-real-password-just-for-timing")

# The website keeps its refresh token in this cookie, which page scripts can't read, so a
# script injected into the site can't steal it. Phones keep theirs in the keychain instead.
REFRESH_COOKIE = "triplet_refresh"

def wants_cookie(request: Request) -> bool:
    # Only the website sends this header. A custom header also makes browsers check with the API
    # first (a CORS preflight), so other sites can't send requests that carry the cookie.
    return request.headers.get("X-Refresh-Cookie") == "1"

def set_refresh_cookie(response: Response, refresh_token: str):
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        # Only sent to the endpoints that need it, never with ordinary API calls
        path=f"{settings.API_PATH_PREFIX}/auth",
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
    )

def clear_refresh_cookie(response: Response):
    response.delete_cookie(REFRESH_COOKIE, path=f"{settings.API_PATH_PREFIX}/auth", httponly=True, secure=settings.is_production, samesite="strict")

def presented_refresh_token(request: Request, refresh_request: RefreshRequest | None) -> str | None:
    if refresh_request is not None and refresh_request.refresh_token:
        return refresh_request.refresh_token
    if wants_cookie(request):
        token = request.cookies.get(REFRESH_COOKIE)
        # Same length limit as a token sent in the body
        if token and len(token) <= 256:
            return token
    return None

def issue_tokens(db: Session, user: User, request: Request, response: Response) -> dict:
    refresh_token = generate_token()

    db.add(RefreshToken(
        user_id=user.id,
        token_hash=hash_token(refresh_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    ))
    db.commit()

    if wants_cookie(request):
        set_refresh_cookie(response, refresh_token)
        refresh_token = None

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

@router.post("/signup", response_model=SignupResponse, status_code=status.HTTP_202_ACCEPTED)
def signup(
    user: UserCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(connect_db)
):
    """
    Start signing up: the account is only created once the emailed code is entered
    (see /verify-email/code), so an unconfirmed sign-up never holds the email.
    """
    rate_limit.hit(db, f"signup-ip:{client_ip(request)}", SIGNUP_IP_LIMIT, SIGNUP_WINDOW,
                   "Too many new accounts from this network. Try again later.")

    # Checks that don't depend on whether the email is taken can still say what's wrong
    name = clean_name(user.name)
    if name is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=NAME_ERROR
        )
    user.name = name
    email_prefix = user.email.split('@')[0]  # Extract the part before '@' for additional checks
    user_inputs = [user.name.lower(), email_prefix.lower()]
    result = password_strength(user.password.lower(), user_inputs)
    if not result["is_valid"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid credentials"
        )

    # Looks just like a real one, but no sign-up is waiting on it
    unused_token = {"detail": CHECK_EMAIL, "signup_token": generate_token()}

    # A few emails an hour to one address at most, so nobody can flood an inbox
    try:
        rate_limit.hit(db, f"verify-email:{user.email}", VERIFY_EMAIL_LIMIT, VERIFY_WINDOW, "")
    except HTTPException:
        logger.info("Not emailing %s: already sent %d emails there in the last hour", user.email, VERIFY_EMAIL_LIMIT)
        return unused_token

    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user is not None:
        # Tell the real owner rather than the person signing up
        background_tasks.add_task(
            send_email,
            existing_user.email,
            "You already have a Triplet account",
            f"Hi {existing_user.name},\n\n"
            "Someone (hopefully you) tried to sign up to Triplet with this email, "
            "but you already have an account.\n\n"
            f"Sign in: {settings.APP_URL}/login\n"
            f"Forgot your password? {settings.APP_URL}/forgot-password\n\n"
            "If it wasn't you, you can ignore this email."
        )
        return unused_token

    signup_token = verification.start_signup(db, background_tasks, user.name, user.email, user.password)
    return {"detail": CHECK_EMAIL, "signup_token": signup_token}

@router.post("/verify-email", response_model=MessageResponse)
def verify_email(
    verify_request: VerifyEmailRequest,
    request: Request,
    db: Session = Depends(connect_db)
):
    rate_limit.hit(db, f"token-ip:{client_ip(request)}", TOKEN_IP_LIMIT, TOKEN_WINDOW,
                   "Too many requests. Wait a moment and try again.")
    verification.confirm(db, verify_request.token)
    return {"detail": "Email confirmed"}

@router.post("/verify-email/code", response_model=Token)
def verify_email_code(
    verify_request: VerifyCodeRequest,
    request: Request,
    response: Response,
    db: Session = Depends(connect_db)
):
    """Enter the code from the sign-up email. It creates the account and signs straight in."""
    rate_limit.hit(db, f"token-ip:{client_ip(request)}", TOKEN_IP_LIMIT, TOKEN_WINDOW,
                   "Too many requests. Wait a moment and try again.")
    user = verification.confirm_signup(db, verify_request.signup_token, verify_request.code)
    return issue_tokens(db, user, request, response)

@router.post("/verify-email/resend", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED)
def resend_verification(
    resend_request: ResendVerificationRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(connect_db)
):
    response = {"detail": "If that sign-up is still waiting, a new code is on its way"}

    rate_limit.hit(db, f"reset-ip:{client_ip(request)}", RESET_IP_LIMIT, RESET_WINDOW,
                   "Too many requests. Try again later.")

    pending = verification.find_signup(db, resend_request.signup_token)
    if pending is None:
        logger.info("Not resending a sign-up code: no sign-up is waiting on that token")
        return response

    try:
        rate_limit.hit(db, f"verify-email:{pending.email}", VERIFY_EMAIL_LIMIT, VERIFY_WINDOW, "")
    except HTTPException:
        logger.info("Not emailing %s: already sent %d emails there in the last hour",
                    pending.email, VERIFY_EMAIL_LIMIT)
        return response

    verification.resend_signup_code(db, background_tasks, pending)
    return response

@router.post("/login", response_model=Token)
def login(
    user: UserLogin,
    request: Request,
    response: Response,
    db: Session = Depends(connect_db)
):
    ip = client_ip(request)
    email_ip_key = f"login-email-ip:{user.email}:{ip}"
    ip_key = f"login-ip:{ip}"
    email_key = f"login-email:{user.email}"
    rate_limit.check(db, email_ip_key, LOGIN_EMAIL_IP_LIMIT, LOGIN_WINDOW, TOO_MANY_LOGINS)
    rate_limit.check(db, ip_key, LOGIN_IP_LIMIT, LOGIN_WINDOW, TOO_MANY_LOGINS)
    rate_limit.check(db, email_key, LOGIN_EMAIL_LIMIT, LOGIN_EMAIL_WINDOW, TOO_MANY_LOGINS)

    user_detail = db.query(User).filter(User.email == user.email).first()
    # Always check a password, even for unknown emails, so both fail equally slowly
    password_ok = verify_password(user_detail.password if user_detail else DUMMY_PASSWORD_HASH, user.password)

    if user_detail is None or not password_ok:
        rate_limit.record(db, email_ip_key, LOGIN_WINDOW)
        rate_limit.record(db, ip_key, LOGIN_WINDOW)
        rate_limit.record(db, email_key, LOGIN_EMAIL_WINDOW)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect credentials"
        )

    rate_limit.clear(db, email_ip_key)

    return issue_tokens(db, user_detail, request, response)

@router.post("/social", response_model=Token)
def social_sign_in(
    social: SocialLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(connect_db)
):
    """
    Sign in with Google or Apple, using the ID token the app got from them.

    The first time, it links to the Triplet account with the same email, or makes a new one. Both are
    safe because Google and Apple have confirmed the person owns that email, and Triplet accounts
    only exist once their email is confirmed too.
    """
    rate_limit.hit(db, f"token-ip:{client_ip(request)}", TOKEN_IP_LIMIT, TOKEN_WINDOW,
                   "Too many requests. Wait a moment and try again.")
    try:
        identity = social_login.verify(social.provider, social.id_token, social.nonce)
    except social_login.SocialLoginError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error))

    linked = db.query(UserIdentity).filter(
        UserIdentity.provider == identity.provider,
        UserIdentity.subject == identity.subject
    ).first()
    if linked is not None:
        return issue_tokens(db, db.get(User, linked.user_id), request, response)

    user = db.query(User).filter(User.email == identity.email).first()
    if user is None:
        user = User(
            # Apple's hidden emails look like "x7k2p9@privaterelay.appleid.com", so that's a last resort
            name=(clean_name(social.name or identity.name or "")
                  or clean_name(identity.email.split("@")[0][:60].replace("_", " ").replace(".", " "))
                  or "Traveller"),
            email=identity.email,
            # There's no password yet; "Forgot password" sets one, which proves the email again
            password=hash_password(generate_token()),
            email_verified_at=datetime.now(timezone.utc)
        )
        db.add(user)
        db.flush()
        verification.attach_invitations(db, user)
        # A half-finished email sign-up for this address is no longer needed
        db.query(PendingSignup).filter(PendingSignup.email == identity.email).delete(synchronize_session=False)
        logger.info("New account %s from %s sign-in", user.id, identity.provider)

    db.add(UserIdentity(user_id=user.id, provider=identity.provider, subject=identity.subject, email=identity.email))
    db.commit()
    return issue_tokens(db, user, request, response)

@router.post("/refresh", response_model=Token)
def refresh(
    request: Request,
    response: Response,
    refresh_request: RefreshRequest | None = None,
    db: Session = Depends(connect_db)
):
    rate_limit.hit(db, f"token-ip:{client_ip(request)}", TOKEN_IP_LIMIT, TOKEN_WINDOW,
                   "Too many requests. Wait a moment and try again.")

    presented = presented_refresh_token(request, refresh_request)
    stored_token = None
    if presented is not None:
        stored_token = db.query(RefreshToken).filter(RefreshToken.token_hash == hash_token(presented)).first()

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

    return issue_tokens(db, user, request, response)

@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    refresh_request: RefreshRequest | None = None,
    db: Session = Depends(connect_db)
):
    # Always succeeds so clients can safely call it with an old token
    presented = presented_refresh_token(request, refresh_request)
    if presented is not None:
        db.query(RefreshToken).filter(
            RefreshToken.token_hash == hash_token(presented),
            RefreshToken.revoked_at.is_(None)
        ).update({"revoked_at": datetime.now(timezone.utc)})
        db.commit()
    if wants_cookie(request):
        clear_refresh_cookie(response)

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
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(connect_db)
):
    # Same response whether or not the email exists, so it can't be used to find accounts
    response = {"detail": "If that email is registered, a reset code has been sent"}

    rate_limit.hit(db, f"reset-ip:{client_ip(request)}", RESET_IP_LIMIT, RESET_WINDOW,
                   "Too many reset requests. Try again later.")

    # Don't let anyone flood an inbox: past a few emails an hour, quietly send nothing more.
    # Counted for every address, registered or not, so this reveals nothing either.
    email_key = f"reset-email:{reset_request.email}"
    try:
        rate_limit.hit(db, email_key, RESET_EMAIL_LIMIT, RESET_WINDOW, "")
    except HTTPException:
        return response

    user = db.query(User).filter(User.email == reset_request.email).first()
    if user is None:
        return response

    # Only the most recent code should work
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None)
    ).update({"used_at": datetime.now(timezone.utc)})

    code = codes.new_code()
    row = PasswordResetToken(
        user_id=user.id,
        # A random placeholder until the row has the id its code's hash is keyed on
        token_hash=hash_token(generate_token()),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.EMAIL_CODE_EXPIRE_MINUTES)
    )
    db.add(row)
    db.flush()
    row.token_hash = codes.code_hash(RESET_CODE_PURPOSE, row.id, code)
    db.commit()

    background_tasks.add_task(
        send_email,
        user.email,
        f"{code} is your Triplet password reset code",
        f"Hi {user.name},\n\n"
        f"Enter this code in Triplet to choose a new password:\n\n    {code}\n\n"
        f"It works for {settings.EMAIL_CODE_EXPIRE_MINUTES} minutes. "
        "If you didn't ask for this, you can ignore this email; your password won't change."
    )

    return response

@router.post("/password-reset/confirm", response_model=MessageResponse)
def confirm_password_reset(
    reset_confirm: PasswordResetConfirm,
    request: Request,
    db: Session = Depends(connect_db)
):
    rate_limit.hit(db, f"token-ip:{client_ip(request)}", TOKEN_IP_LIMIT, TOKEN_WINDOW,
                   "Too many requests. Wait a moment and try again.")

    if reset_confirm.token is not None:
        # A link emailed before codes replaced them
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
    else:
        owner = db.query(User).filter(User.email == reset_confirm.email).first()
        reset_token = (
            db.query(PasswordResetToken)
            .filter(PasswordResetToken.user_id == owner.id, PasswordResetToken.used_at.is_(None))
            .order_by(PasswordResetToken.id.desc())
            .first()
        ) if owner is not None else None
        # Wrong codes count against the code; an unknown email looks like an expired code
        verification.check_code(db, reset_token, RESET_CODE_PURPOSE, reset_confirm.code)

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
