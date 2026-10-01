"""
Reading a reply from another service without trusting its size. Every outside call has a
timeout, but a broken or hijacked service could still send far more than expected, and
`response.read()` would hold all of it in memory.
"""

class TooLarge(OSError):
    """An OSError, so callers that already handle network failures handle this the same way."""

def read_limited(response, limit: int) -> bytes:
    """Up to `limit` bytes of a reply, refusing it if there's more."""
    data = response.read(limit + 1)
    if len(data) > limit:
        raise TooLarge(f"Reply over {limit} bytes")
    return data
