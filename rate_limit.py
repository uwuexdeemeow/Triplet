"""
Fixed-window rate limits kept in the database, so they hold across restarts and across
several server processes.

Each key counts attempts in a window, e.g. 5 failed logins for one email per 15 minutes.
Over the limit, the request gets 429 Too Many Requests with a Retry-After header.
"""
from datetime import datetime, timedelta, timezone
from math import ceil
import random

from fastapi import HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config import settings
from models import RateLimit
from validators import as_utc

# No window is longer than a day, so older rows are only clutter
STALE_AFTER = timedelta(days=2)
# Roughly one write in a hundred tidies up, so the table can't grow without end
CLEANUP_CHANCE = 0.01

def client_ip(request: Request) -> str:
    """The visitor's address, for rate limits.

    Behind a hosting proxy the connection comes from the proxy, which adds the real address to the
    end of X-Forwarded-For. Only the entries added by the trusted proxies count: anything to their
    left came from the visitor and could be anything, which would dodge the limits.
    """
    if settings.TRUSTED_PROXY_HOPS > 0:
        forwarded = [part.strip() for part in request.headers.get("X-Forwarded-For", "").split(",") if part.strip()]
        if len(forwarded) >= settings.TRUSTED_PROXY_HOPS:
            return forwarded[-settings.TRUSTED_PROXY_HOPS]
    return request.client.host if request.client else "unknown"

def _row(db: Session, key: str) -> RateLimit:
    row = db.query(RateLimit).filter(RateLimit.key == key).first()
    if row is None:
        try:
            with db.begin_nested():
                db.add(RateLimit(key=key, window_start=datetime.now(timezone.utc), count=0))
        except IntegrityError:
            # Another request created it first
            pass
        row = db.query(RateLimit).filter(RateLimit.key == key).one()
    return row

def _too_many(retry_after: timedelta, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=message,
        headers={"Retry-After": str(max(1, ceil(retry_after.total_seconds())))}
    )

def _remaining(row: RateLimit, window: timedelta, now: datetime) -> timedelta:
    return as_utc(row.window_start) + window - now

def check(db: Session, key: str, limit: int, window: timedelta, message: str):
    """Refuse if `key` has already used up its attempts in the current window. Doesn't count one."""
    if not settings.RATE_LIMITS_ENABLED:
        return
    row = db.query(RateLimit).filter(RateLimit.key == key).first()
    now = datetime.now(timezone.utc)
    if row is not None and _remaining(row, window, now) > timedelta(0) and row.count >= limit:
        raise _too_many(_remaining(row, window, now), message)

def record(db: Session, key: str, window: timedelta):
    """Count one attempt for `key`, starting a fresh window if the last one has ended. Commits."""
    if not settings.RATE_LIMITS_ENABLED:
        return
    row = _row(db, key)
    now = datetime.now(timezone.utc)
    if _remaining(row, window, now) <= timedelta(0):
        # Conditional, so two requests starting a new window together don't both reset it
        db.query(RateLimit).filter(RateLimit.id == row.id, RateLimit.window_start == row.window_start).update(
            {"window_start": now, "count": 1}, synchronize_session=False
        )
    else:
        db.query(RateLimit).filter(RateLimit.id == row.id).update({"count": RateLimit.count + 1}, synchronize_session=False)
    if random.random() < CLEANUP_CHANCE:
        db.query(RateLimit).filter(RateLimit.window_start < now - STALE_AFTER).delete(synchronize_session=False)
    db.commit()

def hit(db: Session, key: str, limit: int, window: timedelta, message: str):
    """Count one attempt and refuse it if that goes over the limit."""
    check(db, key, limit, window, message)
    record(db, key, window)

def clear(db: Session, key: str):
    """Forget a key's attempts, e.g. after a successful login. Commits."""
    if not settings.RATE_LIMITS_ENABLED:
        return
    db.query(RateLimit).filter(RateLimit.key == key).delete(synchronize_session=False)
    db.commit()
