"""
Profile photo addresses. Photos are served without a sign-in, so image views can load them, but
each address carries a signature for that exact photo: user ids are sequential, and without it
anyone could download everyone's photo by counting through them.
"""
import hashlib
import hmac

from config import settings

def photo_version(data: bytes) -> str:
    """Changes with every new photo, so apps don't keep showing a cached old one."""
    return hashlib.sha256(data).hexdigest()[:12]

def signature(user_id: int, version: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f"avatar:{user_id}:{version}".encode(), hashlib.sha256).hexdigest()[:32]

def photo_path(user_id: int, version: str) -> str:
    return f"/users/{user_id}/avatar?v={version}&sig={signature(user_id, version)}"

def valid(user_id: int, version: str, sig: str, data: bytes) -> bool:
    """Whether an address is for this user's current photo: signed by us, and not for an older one."""
    return hmac.compare_digest(sig, signature(user_id, version)) and hmac.compare_digest(version, photo_version(data))

# Trip cover photos work the same way, signed separately so a photo's address can't be reused
# for another trip's or a person's
def cover_signature(trip_id: int, version: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f"cover:{trip_id}:{version}".encode(), hashlib.sha256).hexdigest()[:32]

def cover_path(trip_id: int, version: str) -> str:
    return f"/trips/{trip_id}/cover?v={version}&sig={cover_signature(trip_id, version)}"

def cover_valid(trip_id: int, version: str, sig: str, data: bytes) -> bool:
    return hmac.compare_digest(sig, cover_signature(trip_id, version)) and hmac.compare_digest(version, photo_version(data))
