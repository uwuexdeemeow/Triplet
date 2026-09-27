from collections import defaultdict
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from config import settings
from database import connect_db
from models import Trip, TripMembership, SavedLink, ExtractedPlace, Activity
from schemas import TripPlaceResponse, PlaceUpdate, PlaceSearchResult
from dependencies import get_trip_membership, require_role, EDITOR_ROLES
import rate_limit
from places_lookup import active_provider, search_places, search_places_osm, reserve_call, PlacesError, PlacesQuotaError, SEARCH_API
from osm_lookup import OsmError
from photon_lookup import PhotonError, locate, reverse, suggest

router = APIRouter(
    prefix="/trips/{trip_id}/places",
    tags=["Places"]
)

# Searches go to shared free services (OpenStreetMap, Photon) that ban heavy users,
# so each person gets a generous but finite number per minute
# Suggestions fire as people type, so this is well above what a fast typist needs
LOOKUP_LIMIT = 120
LOOKUP_WINDOW = timedelta(minutes=1)

def limit_lookups(db: Session, membership: TripMembership):
    rate_limit.hit(db, f"lookup-user:{membership.user_id}", LOOKUP_LIMIT, LOOKUP_WINDOW,
                   "Too many searches in a row. Wait a moment and try again.")

def get_place_or_404(db: Session, trip_id: int, place_id: int) -> ExtractedPlace:
    place = (
        db.query(ExtractedPlace)
        .join(SavedLink, SavedLink.id == ExtractedPlace.link_id)
        .filter(
            ExtractedPlace.id == place_id,
            SavedLink.trip_id == trip_id
        )
        .first()
    )

    if place is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Place not found"
        )

    return place

def with_activity_ids(db: Session, places: list[ExtractedPlace]) -> list[TripPlaceResponse]:
    activity_ids = defaultdict(list)
    rows = (
        db.query(Activity.place_id, Activity.id)
        .filter(Activity.place_id.in_([place.id for place in places]))
        .order_by(Activity.start_time, Activity.id)
        .all()
    )
    for place_id, activity_id in rows:
        activity_ids[place_id].append(activity_id)

    return [
        TripPlaceResponse.model_validate(place).model_copy(update={"activity_ids": activity_ids[place.id]})
        for place in places
    ]

@router.get("", response_model=list[TripPlaceResponse])
def get_places(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    # Everything found in the trip's saved links, for the map and the Saved tab
    places = (
        db.query(ExtractedPlace)
        .join(SavedLink, SavedLink.id == ExtractedPlace.link_id)
        .filter(SavedLink.trip_id == trip_id)
        .order_by(ExtractedPlace.id)
        .all()
    )

    return with_activity_ids(db, places)

@router.get("/search", response_model=list[PlaceSearchResult])
def search(
    trip_id: int,
    q: str = Query(min_length=2, max_length=255),
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    limit_lookups(db, membership)
    provider = active_provider()
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Place search is not configured, drop a pin on the map instead"
        )

    # Only Google costs money, so only Google searches count towards a daily cap
    if provider == "google" and not reserve_call(db, SEARCH_API, settings.PLACES_SEARCH_DAILY_LIMIT):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Place search limit reached for today, drop a pin on the map instead"
        )

    # Searching "Menya Itto" should find the one near the trip, not one in another country
    destination = db.query(Trip.destination).filter(Trip.id == trip_id).scalar()
    query = q if not destination or destination.casefold() in q.casefold() else f"{q}, {destination}"

    try:
        return search_places(query) if provider == "google" else search_places_osm(query)
    except PlacesQuotaError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Place search limit reached for today, drop a pin on the map instead"
        )
    except (PlacesError, OsmError):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Place search is unavailable right now"
        )

@router.get("/suggest", response_model=list[PlaceSearchResult])
def suggest_places(
    trip_id: int,
    q: str = Query(min_length=2, max_length=255),
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """Suggestions while typing a location. Free OpenStreetMap data, so no daily cap."""
    limit_lookups(db, membership)
    destination = db.query(Trip.destination).filter(Trip.id == trip_id).scalar()

    try:
        # Rank places near the trip first, so "Ichiran" finds the one in Tokyo
        near = locate(destination) if destination else None
        return suggest(q.strip(), near)
    except PhotonError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Place suggestions are unavailable right now"
        )

@router.get("/reverse", response_model=PlaceSearchResult | None)
def reverse_place(
    trip_id: int,
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """The name and address at a pin dropped on the map, or null when there's nothing there."""
    limit_lookups(db, membership)
    try:
        return reverse(lat, lon)
    except PhotonError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Place lookup is unavailable right now"
        )

@router.get("/{place_id}", response_model=TripPlaceResponse)
def get_place(
    trip_id: int,
    place_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    return with_activity_ids(db, [get_place_or_404(db, trip_id, place_id)])[0]

@router.patch("/{place_id}", response_model=TripPlaceResponse)
def update_place(
    trip_id: int,
    place_id: int,
    place_update: PlaceUpdate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    place = get_place_or_404(db, trip_id, place_id)

    update_data = place_update.model_dump(
        exclude_unset=True
    )

    # name is NOT NULL, so an explicit null means "leave unchanged"
    if update_data.get("name", "") is None:
        del update_data["name"]

    if update_data.get("website") is not None:
        update_data["website"] = str(update_data["website"])

    for field, value in update_data.items():
        setattr(place, field, value)

    # From now on this is the user's version, so lookups leave it alone
    place.user_edited = True
    place.needs_review = False

    db.commit()
    db.refresh(place)

    return with_activity_ids(db, [place])[0]

@router.delete("/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_place(
    trip_id: int,
    place_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    place = get_place_or_404(db, trip_id, place_id)

    # Planned activities stay in the itinerary, they just lose the link to this place
    db.delete(place)
    db.commit()
