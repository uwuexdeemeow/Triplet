import json
import logging
from datetime import datetime, timezone
from difflib import SequenceMatcher
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config import settings
import osm_lookup
from models import ApiUsage, ExtractedPlace

logger = logging.getLogger("triplet.places")

PLACES_URL = "https://places.googleapis.com/v1"

# Asking only for ids keeps Text Search on the free "IDs Only" tier
ID_SEARCH_FIELDS = "places.id"
# Opening hours, website and phone are Enterprise fields: 1,000 free calls a month
DETAILS_FIELDS = "id,displayName,formattedAddress,location,regularOpeningHours,websiteUri,internationalPhoneNumber"
# Name, address and location for the pin picker are Pro fields: 5,000 free calls a month
PICKER_SEARCH_FIELDS = "places.id,places.displayName,places.formattedAddress,places.location"

DETAILS_API = "places_details"
SEARCH_API = "places_search"

class PlacesError(Exception):
    """The Places API couldn't be reached or returned an error."""

class PlacesQuotaError(PlacesError):
    """Google refused the call because a quota was used up."""

def _request(url: str, field_mask: str, body: dict | None = None, timeout: float = 10.0) -> dict:
    headers = {
        "X-Goog-Api-Key": settings.GOOGLE_PLACES_API_KEY or "",
        "X-Goog-FieldMask": field_mask,
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")

    try:
        with urlopen(Request(url, data=data, headers=headers), timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        if e.code == 429:
            raise PlacesQuotaError("Places API quota reached") from e
        raise PlacesError(f"Places API returned {e.code}") from e
    except (OSError, ValueError) as e:
        raise PlacesError("Could not reach the Places API") from e

def search_place_ids(query: str) -> list[str]:
    """
    Find Google place ids for a text query. Free and unlimited.

    Args:
        query (str): e.g. "Menya Itto, Tokyo, Japan".

    Returns:
        list[str]: Matching place ids, best match first.
    """
    result = _request(
        f"{PLACES_URL}/places:searchText",
        ID_SEARCH_FIELDS,
        {"textQuery": query, "pageSize": 5},
    )
    return [place["id"] for place in result.get("places", []) if place.get("id")]

def get_place_details(place_id: str) -> dict:
    """
    Get a place's address, location, opening hours, website and phone. Counts towards the daily cap.

    Args:
        place_id (str): A Google place id.

    Returns:
        dict: The fields in the shape ExtractedPlace uses.
    """
    result = _request(
        f"{PLACES_URL}/places/{quote(place_id, safe='')}?{urlencode({'languageCode': 'en'})}",
        DETAILS_FIELDS,
    )

    location = result.get("location") or {}
    weekday_descriptions = (result.get("regularOpeningHours") or {}).get("weekdayDescriptions")

    opening_hours = None
    if weekday_descriptions and len(weekday_descriptions) == 7:
        # "Monday: 11:00 AM – 3:00 PM" -> "11:00 AM – 3:00 PM"
        opening_hours = [day.split(": ", 1)[-1] for day in weekday_descriptions]

    return {
        "google_name": (result.get("displayName") or {}).get("text"),
        "address": result.get("formattedAddress"),
        "latitude": location.get("latitude"),
        "longitude": location.get("longitude"),
        "opening_hours": opening_hours,
        "website": result.get("websiteUri"),
        "phone": result.get("internationalPhoneNumber"),
    }

def search_places(query: str) -> list[dict]:
    """
    Search places with their name, address and location, for the map pin picker.

    Args:
        query (str): What the user typed.

    Returns:
        list[dict]: Up to 5 results.
    """
    result = _request(
        f"{PLACES_URL}/places:searchText",
        PICKER_SEARCH_FIELDS,
        {"textQuery": query, "pageSize": 5, "languageCode": "en"},
    )

    return [
        {
            "google_place_id": place["id"],
            "name": (place.get("displayName") or {}).get("text") or "",
            "address": place.get("formattedAddress"),
            "latitude": (place.get("location") or {}).get("latitude"),
            "longitude": (place.get("location") or {}).get("longitude"),
        }
        for place in result.get("places", [])
        if place.get("id")
    ]

def reserve_call(db: Session, api: str, daily_limit: int) -> bool:
    """
    Count one call against today's limit for a paid API.

    Args:
        db (Session): Database session. Commits the new count.
        api (str): Which API the call is for.
        daily_limit (int): Maximum calls per day (UTC).

    Returns:
        bool: True if the call is allowed, False if today's limit is used up.
    """
    today = datetime.now(timezone.utc).date()

    if db.query(ApiUsage).filter(ApiUsage.api == api, ApiUsage.day == today).first() is None:
        try:
            with db.begin_nested():
                db.add(ApiUsage(api=api, day=today, count=0))
        except IntegrityError:
            # Another request created today's row first
            pass

    # A conditional update so parallel lookups can't both take the last call
    reserved = db.query(ApiUsage).filter(
        ApiUsage.api == api,
        ApiUsage.day == today,
        ApiUsage.count < daily_limit
    ).update({"count": ApiUsage.count + 1}, synchronize_session=False)
    db.commit()

    return reserved == 1

def names_match(a: str, b: str | None) -> bool:
    if not b:
        return False
    a, b = a.casefold().strip(), b.casefold().strip()
    return a in b or b in a or SequenceMatcher(None, a, b).ratio() >= 0.6

def active_provider() -> str | None:
    """Which lookup service to use: "google", "osm", or None when lookups are off."""
    provider = settings.PLACE_LOOKUP_PROVIDER
    if provider == "auto":
        return "google" if settings.GOOGLE_PLACES_API_KEY else "osm"
    if provider == "google" and not settings.GOOGLE_PLACES_API_KEY:
        return None
    return None if provider == "none" else provider

def enrich_place(db: Session, place: ExtractedPlace, fallback_city: str | None = None):
    """
    Fill in a place's address, location, opening hours, website and phone.

    Never touches a place the user has edited. Sets details_status to found, not_found,
    limit_reached, failed or skipped. The caller is responsible for committing.

    Args:
        db (Session): Database session, used for the daily cap.
        place (ExtractedPlace): The place to look up.
        fallback_city (str | None): Used when the post didn't say which city, e.g. the trip destination.
    """
    if place.user_edited:
        return

    provider = active_provider()
    if provider is None:
        place.details_status = "skipped"
        return

    query = ", ".join(part for part in [place.name, place.address, place.city or fallback_city, place.country] if part)

    if provider == "osm":
        _enrich_from_osm(place, query)
    else:
        _enrich_from_google(db, place, query)

    if place.details_status == "found":
        place.details_fetched_at = datetime.now(timezone.utc)
        place.details_source = provider

def _enrich_from_osm(place: ExtractedPlace, query: str):
    try:
        results = osm_lookup.nominatim_search(query)
    except osm_lookup.OsmError:
        logger.exception("OpenStreetMap search failed for %s", place.id)
        place.details_status = "failed"
        return

    # Only trust a result whose name matches, otherwise we might pin a street or a different shop
    match = next(
        (result for result in results if any(names_match(place.name, name) for name in osm_lookup.all_names(result))),
        None
    )
    if match is None:
        place.details_status = "not_found"
        return

    tags = match.get("extratags") or {}
    place.address = (match.get("display_name") or place.address or "")[:500] or None
    place.latitude = float(match["lat"])
    place.longitude = float(match["lon"])
    place.opening_hours = osm_lookup.parse_opening_hours(tags.get("opening_hours"))
    place.website = (tags.get("website") or tags.get("contact:website") or "")[:2048] or None
    place.phone = (tags.get("phone") or tags.get("contact:phone") or "")[:50] or None
    place.needs_review = False
    place.details_status = "found"

def _enrich_from_google(db: Session, place: ExtractedPlace, query: str):
    try:
        place_ids = search_place_ids(query)
    except PlacesQuotaError:
        place.details_status = "limit_reached"
        return
    except PlacesError:
        logger.exception("Place search failed for %s", place.id)
        place.details_status = "failed"
        return

    if not place_ids:
        place.details_status = "not_found"
        return

    place.google_place_id = place_ids[0]

    if not reserve_call(db, DETAILS_API, settings.PLACES_DETAILS_DAILY_LIMIT):
        # Out of free lookups for today, so the user fills in the details themselves
        place.details_status = "limit_reached"
        return

    try:
        details = get_place_details(place_ids[0])
    except PlacesQuotaError:
        place.details_status = "limit_reached"
        return
    except PlacesError:
        logger.exception("Place details failed for %s", place.id)
        place.details_status = "failed"
        return

    # Keep the name from the post, but flag the match if Google's name looks different
    place.needs_review = not names_match(place.name, details["google_name"])
    for field in ["address", "latitude", "longitude", "opening_hours", "website", "phone"]:
        if details[field] is not None:
            setattr(place, field, details[field])

    place.details_status = "found"

def search_places_osm(query: str) -> list[dict]:
    """
    Search OpenStreetMap for the pin picker. Only call this when the user submits a search,
    never on each keystroke, as Nominatim's usage policy forbids autocomplete.

    Args:
        query (str): What the user typed.

    Returns:
        list[dict]: Up to 5 results in the same shape as search_places.
    """
    return [
        {
            "google_place_id": None,
            "name": result.get("name") or (result.get("display_name") or "").split(",")[0],
            "address": result.get("display_name"),
            "latitude": float(result["lat"]),
            "longitude": float(result["lon"]),
        }
        for result in osm_lookup.nominatim_search(query)
    ]
