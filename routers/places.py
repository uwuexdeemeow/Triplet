from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from config import settings
from database import connect_db
from models import Trip, TripMembership, SavedLink, ExtractedPlace, Activity
from schemas import TripPlaceResponse, PlaceUpdate, PlaceSearchResult
from dependencies import get_trip_membership, require_role, EDITOR_ROLES
from places_lookup import search_places, reserve_call, PlacesError, PlacesQuotaError, SEARCH_API

router = APIRouter(
    prefix="/trips/{trip_id}/places",
    tags=["Places"]
)

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
    if not settings.GOOGLE_PLACES_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Place search is not configured, drop a pin on the map instead"
        )

    if not reserve_call(db, SEARCH_API, settings.PLACES_SEARCH_DAILY_LIMIT):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Place search limit reached for today, drop a pin on the map instead"
        )

    # Searching "Menya Itto" should find the one near the trip, not one in another country
    destination = db.query(Trip.destination).filter(Trip.id == trip_id).scalar()
    query = q if not destination or destination.casefold() in q.casefold() else f"{q}, {destination}"

    try:
        return search_places(query)
    except PlacesQuotaError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Place search limit reached for today, drop a pin on the map instead"
        )
    except PlacesError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Place search is unavailable right now"
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
