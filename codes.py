"""
Six-digit codes emailed to prove someone controls an inbox: for signing up, changing email and
resetting a password.

A code has only a million possibilities, so it's kept safe in three ways: it expires quickly,
each one locks after a few wrong tries (on top of per-network rate limits), and only a keyed
hash is stored. The key is the server's secret plus the code's own row id, so a copy of the
database alone can't be used to work codes out, and no two rows can share a hash.
"""
import hashlib
import hmac
import secrets

from config import settings

CODE_DIGITS = 6
MAX_ATTEMPTS = 5

def new_code() -> str:
    return f"{secrets.randbelow(10 ** CODE_DIGITS):0{CODE_DIGITS}d}"

def code_hash(purpose: str, row_id: int, code: str) -> str:
    message = f"{purpose}:{row_id}:{code}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()

def matches(purpose: str, row_id: int, code: str, stored_hash: str) -> bool:
    return hmac.compare_digest(code_hash(purpose, row_id, normalise(code)), stored_hash)

def normalise(code: str) -> str:
    # People paste codes with spaces or dashes, e.g. "123 456"
    return "".join(char for char in code if char.isdigit())
