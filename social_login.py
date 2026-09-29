"""
Sign in with Google or Apple.

The app signs in with Google or Apple on the phone and sends the ID token it gets back. That token is
only trusted after checking, here, that:
- it's signed by Google or Apple (with the keys they publish),
- it was issued for this app (the audience is one of our client ids), by them, and hasn't expired,
- the email in it is verified, and for Apple, it answers the nonce this sign-in started with,
  so a token caught from another sign-in can't be replayed.
"""
import hashlib
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient

from config import settings

PROVIDERS = {
    "google": {
        "keys": "https://www.googleapis.com/oauth2/v3/certs",
        "issuers": ["https://accounts.google.com", "accounts.google.com"],
    },
    "apple": {
        "keys": "https://appleid.apple.com/auth/keys",
        "issuers": ["https://appleid.apple.com"],
    },
}

# Fetches each provider's public keys once and keeps them, refetching for a key it hasn't seen
_key_clients = {name: PyJWKClient(provider["keys"], cache_keys=True, lifespan=6 * 60 * 60, timeout=10)
                for name, provider in PROVIDERS.items()}

class SocialLoginError(Exception):
    """The token can't be trusted; the message is safe to show."""

@dataclass
class Identity:
    provider: str
    subject: str
    email: str
    name: str | None

def client_ids(provider: str) -> list[str]:
    return settings.GOOGLE_CLIENT_IDS if provider == "google" else settings.APPLE_CLIENT_IDS

def verify(provider: str, id_token: str, nonce: str | None = None) -> Identity:
    """Check an ID token from Google or Apple and say who it's for. Raises SocialLoginError."""
    audiences = client_ids(provider)
    if provider not in PROVIDERS or not audiences:
        raise SocialLoginError("That way of signing in isn't available")

    try:
        key = _key_clients[provider].get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token,
            key.key,
            algorithms=["RS256"],
            audience=audiences,
            issuer=PROVIDERS[provider]["issuers"],
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
    except (jwt.PyJWTError, jwt.PyJWKClientError) as error:
        raise SocialLoginError("Sign-in didn't go through. Try again.") from error

    if provider == "apple":
        # The app sent Apple a hash of a random nonce and sends us the nonce itself
        expected = hashlib.sha256(nonce.encode()).hexdigest() if nonce else None
        if not expected or claims.get("nonce") != expected:
            raise SocialLoginError("Sign-in didn't go through. Try again.")

    email = claims.get("email")
    # Apple sends "true" as a string, Google as a boolean
    if not email or str(claims.get("email_verified")).lower() != "true":
        raise SocialLoginError("Your account needs a confirmed email address to sign in to Triplet")

    return Identity(
        provider=provider,
        subject=str(claims["sub"]),
        email=email.lower(),
        name=claims.get("name"),
    )
