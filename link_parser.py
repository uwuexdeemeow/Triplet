import json
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

PLATFORM_DOMAINS = {
    "tiktok": ["tiktok.com"],
    "instagram": ["instagram.com"],
    "youtube": ["youtube.com", "youtu.be"],
    "google_maps": ["maps.google.com", "maps.app.goo.gl", "goo.gl"],
}

# Platforms whose links point at a video that can be downloaded and analysed
VIDEO_PLATFORMS = ["tiktok", "youtube", "instagram"]
# Any other web page, like a blog post or travel article: its text is read for places
ARTICLE = "other"
# An image someone uploaded instead of a link
SCREENSHOT = "screenshot"

# Public oEmbed endpoints that don't need an API key
OEMBED_ENDPOINTS = {
    "tiktok": "https://www.tiktok.com/oembed",
    "youtube": "https://www.youtube.com/oembed",
}

def detect_platform(url: str) -> str:
    """
    Work out which platform a shared link comes from based on its domain.

    Args:
        url (str): The shared link.

    Returns:
        str: The platform name, or "other" if it isn't recognised.
    """
    host = (urlparse(url).hostname or "").lower()

    for platform, domains in PLATFORM_DOMAINS.items():
        for domain in domains:
            if host == domain or host.endswith("." + domain):
                return platform

    return "other"

def fetch_metadata(url: str, platform: str, timeout: float = 5.0) -> dict | None:
    """
    Fetch the title, author and thumbnail of a post through the platform's oEmbed API.

    Args:
        url (str): The shared link.
        platform (str): The platform returned by detect_platform.
        timeout (float, optional): Seconds to wait for the platform to respond.

    Returns:
        dict | None: The metadata, or None if the platform isn't supported or the request failed.
    """
    endpoint = OEMBED_ENDPOINTS.get(platform)
    if endpoint is None:
        return None

    request = Request(
        f"{endpoint}?{urlencode({'url': url, 'format': 'json'})}",
        headers={"User-Agent": "TripletBot/1.0"}
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError):
        return None

    return {
        "title": (data.get("title") or "")[:500] or None,
        "author_name": (data.get("author_name") or "")[:255] or None,
        "thumbnail_url": (data.get("thumbnail_url") or "")[:2048] or None,
    }
