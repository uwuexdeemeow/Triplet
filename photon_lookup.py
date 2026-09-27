import json
import threading
from collections import OrderedDict
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from config import settings

# Photon searches OpenStreetMap data and, unlike Nominatim, is built for search-as-you-type,
# so the "Where" field's suggestions use it. Data © OpenStreetMap contributors.
PHOTON_URL = "https://photon.komoot.io/api/"

# Typing "Menya", "Menya I", "Menya It" repeats a lot of queries, so remember recent answers
CACHE_SIZE = 500
_cache: OrderedDict[tuple, list[dict]] = OrderedDict()
_cache_lock = threading.Lock()

class PhotonError(Exception):
    """Photon couldn't be reached or returned something unexpected."""

def _cached(key: tuple, fetch) -> list[dict]:
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]

    value = fetch()

    with _cache_lock:
        _cache[key] = value
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return value

def photon_request(params: dict) -> list[dict]:
    """Raw GeoJSON features from Photon."""
    # English names where OpenStreetMap has them, e.g. "Menya Itto" rather than "麵屋一燈"
    params = {**params, "lang": "en"}
    request = Request(f"{PHOTON_URL}?{urlencode(params)}", headers={"User-Agent": settings.OSM_USER_AGENT})
    try:
        with urlopen(request, timeout=8) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError) as e:
        raise PhotonError("Could not reach the place search") from e

    features = data.get("features") if isinstance(data, dict) else None
    if not isinstance(features, list):
        raise PhotonError("Unexpected response from the place search")
    return features

def locate(text: str) -> tuple[float, float] | None:
    """Rough coordinates for a destination like "Tokyo", used to rank nearby suggestions first."""
    def fetch():
        features = photon_request({"q": text, "limit": 1})
        return [feature for feature in features if _coordinates(feature)]

    features = _cached(("locate", text.strip().casefold()), fetch)
    return _coordinates(features[0]) if features else None

def suggest(query: str, near: tuple[float, float] | None = None, limit: int = 6) -> list[dict]:
    """
    Places whose name starts like the query, nearest to `near` first.

    Returns:
        list[dict]: {"name", "address", "latitude", "longitude"} for each suggestion.
    """
    def fetch():
        params = {"q": query, "limit": limit}
        if near:
            params["lat"], params["lon"] = near
        features = photon_request(params)

        suggestions, seen = [], set()
        for feature in features:
            suggestion = to_suggestion(feature)
            key = (suggestion["name"], suggestion["address"]) if suggestion else None
            if suggestion and key not in seen:
                seen.add(key)
                suggestions.append(suggestion)
        return suggestions

    return _cached(("suggest", query.strip().casefold(), near), fetch)

def _coordinates(feature: dict) -> tuple[float, float] | None:
    try:
        longitude, latitude = feature["geometry"]["coordinates"][:2]
        return float(latitude), float(longitude)
    except (KeyError, TypeError, ValueError):
        return None

def to_suggestion(feature: dict) -> dict | None:
    """One Photon feature as a name, a readable address and a pin."""
    coordinates = _coordinates(feature)
    properties = feature.get("properties") or {}
    street = " ".join(part for part in (properties.get("housenumber"), properties.get("street")) if part)
    name = properties.get("name") or street
    if not coordinates or not name:
        return None

    parts = []
    for part in (street, properties.get("district"), properties.get("city"), properties.get("state"), properties.get("country")):
        # Skip repeats, e.g. a city named after its state, or a street that is the name itself
        if part and part != name and part not in parts:
            parts.append(part)

    return {
        "name": name,
        "address": ", ".join(parts) or None,
        "latitude": coordinates[0],
        "longitude": coordinates[1],
    }
