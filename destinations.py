"""
The places a trip goes: suggestions while typing one ("Kyo" → Kyoto, Japan), and a pin and
country for a name typed without picking a suggestion.
"""
from currencies import COUNTRY_CURRENCY
from photon_lookup import PhotonError, _cached, _coordinates, photon_request

# Only OpenStreetMap "place" features (towns, islands, regions, countries), not restaurants or
# streets. Big, well-known kinds come first, so "Par" finds Paris before a village called Par.
PLACE_RANK = {
    "country": 0, "state": 0, "province": 0, "region": 0, "city": 0, "island": 0, "archipelago": 0,
    "town": 1, "county": 1, "municipality": 1,
    "village": 2, "suburb": 2, "hamlet": 2,
}

def _to_destination(feature: dict) -> dict | None:
    coordinates = _coordinates(feature)
    properties = feature.get("properties") or {}
    name = properties.get("name")
    if not coordinates or not name:
        return None

    parts = []
    for part in (properties.get("state"), properties.get("country")):
        # "Tokyo, Japan" rather than "Tokyo, Tokyo, Japan"
        if part and part != name and part not in parts:
            parts.append(part)

    country = properties.get("countrycode")
    country = country.upper() if isinstance(country, str) and len(country) == 2 else None
    return {
        "name": name,
        "address": ", ".join(parts) or None,
        "latitude": coordinates[0],
        "longitude": coordinates[1],
        "country_code": country,
        "currency": COUNTRY_CURRENCY.get(country) if country else None,
    }

def suggest(query: str, limit: int = 6) -> list[dict]:
    """Places whose name starts like the query, each with a pin, country and currency."""
    def fetch():
        # Ask for extra, since some are repeats or the wrong kind of place
        features = photon_request({"q": query, "limit": limit * 3, "osm_tag": "place"})
        found, seen = [], set()
        for feature in features:
            rank = PLACE_RANK.get((feature.get("properties") or {}).get("osm_value"))
            destination = _to_destination(feature) if rank is not None else None
            key = (destination["name"], destination["address"]) if destination else None
            if destination and key not in seen:
                seen.add(key)
                found.append((rank, destination))
        # Sorting keeps Photon's order within each rank
        found.sort(key=lambda pair: pair[0])
        return [destination for _, destination in found[:limit]]

    return _cached(("destinations", query.strip().casefold(), limit), fetch)

def find(name: str) -> dict | None:
    """The best match for a name typed without picking a suggestion, or None."""
    try:
        found = suggest(name, limit=1)
    except PhotonError:
        return None
    return found[0] if found else None

def fill_in(destinations: list[dict]) -> list[dict]:
    """Add a pin and country to places typed without picking a suggestion, where one is found."""
    filled = []
    for destination in destinations:
        if destination.get("latitude") is None or destination.get("longitude") is None:
            match = find(destination["name"])
            if match:
                destination = {
                    **destination,
                    "address": destination.get("address") or match["address"],
                    "latitude": match["latitude"],
                    "longitude": match["longitude"],
                    "country_code": destination.get("country_code") or match["country_code"],
                }
        filled.append(destination)
    return filled

def summary(destinations: list[dict]) -> str:
    """The names for showing in one line, e.g. "Tokyo, Kyoto", within the 255-character column."""
    text = ", ".join(destination["name"] for destination in destinations)
    return text if len(text) <= 255 else text[:254].rstrip(", ") + "…"
