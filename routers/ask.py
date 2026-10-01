from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import assistant
import rate_limit
import scheduling
from database import connect_db
from models import Trip, TripMembership, SavedLink, ExtractedPlace, Activity, Stay, Flight, User
from schemas import AskRequest, AskResponse, AskMention
from dependencies import get_trip_membership

router = APIRouter(
    prefix="/trips/{trip_id}/ask",
    tags=["Ask"]
)

# Each question is an AI call, so cap them per person
ASK_DAILY_LIMIT = 30

def trip_context(db: Session, trip: Trip) -> assistant.TripContext:
    """Everything the assistant may use to answer: the trip, its saved places and its plans."""
    rows = (
        db.query(ExtractedPlace, SavedLink, User.name)
        .join(SavedLink, SavedLink.id == ExtractedPlace.link_id)
        .outerjoin(User, User.id == SavedLink.added_by_id)
        .filter(SavedLink.trip_id == trip.id)
        .order_by(ExtractedPlace.id)
        .all()
    )
    activities = (
        db.query(Activity)
        .filter(Activity.trip_id == trip.id)
        .order_by(Activity.start_time, Activity.id)
        .all()
    )
    planned_at: dict[int, list[str]] = {}
    for activity in activities:
        if activity.place_id is not None:
            planned_at.setdefault(activity.place_id, []).append(activity.start_time.strftime("%a %d %b %H:%M"))

    spots = []
    for place, link, saved_by in rows:
        details = {
            "category": place.category,
            "address": place.address,
            "city": place.city,
            "price": place.price_range,
            "opening_hours_mon_to_sun": place.opening_hours,
            "hours_the_post_mentions": place.hours_from_post,
            "notes": place.notes,
            "saved_by": saved_by,
            "from_post": link.custom_title or link.title,
            "post_summary": link.summary,
            "in_the_plan_at": planned_at.get(place.id),
            "has_map_pin": place.latitude is not None,
        }
        spots.append(assistant.Spot(
            key=f"place-{place.id}", name=place.name, kind="saved place",
            details={k: v for k, v in details.items() if v not in (None, [], "")},
            latitude=place.latitude, longitude=place.longitude, place_id=place.id
        ))

    places = {place.id: place for place, _, _ in rows}
    for activity in activities:
        place = places.get(activity.place_id)
        lat = activity.latitude if activity.latitude is not None else (place.latitude if place else None)
        lon = activity.longitude if activity.longitude is not None else (place.longitude if place else None)
        details = {
            "when": f"{activity.start_time.strftime('%a %d %b %H:%M')}–{scheduling.format_clock(scheduling.minutes_of(activity.end_time))}",
            "location": activity.location,
            "description": activity.description,
            "estimated_cost": float(activity.estimated_cost) if activity.estimated_cost is not None else None,
            "has_map_pin": lat is not None,
        }
        spots.append(assistant.Spot(
            key=f"plan-{activity.id}", name=activity.title, kind="plan",
            details={k: v for k, v in details.items() if v not in (None, "")},
            latitude=lat, longitude=lon, activity_id=activity.id
        ))

    stays = db.query(Stay).filter(Stay.trip_id == trip.id).order_by(Stay.check_in).all()
    for stay in stays:
        details = {
            "nights": f"{stay.check_in:%a %d %b} to check-out {stay.check_out:%a %d %b}",
            "address": stay.address,
            "has_map_pin": stay.latitude is not None,
        }
        spots.append(assistant.Spot(
            key=f"stay-{stay.id}", name=stay.name, kind="hotel booked",
            details={k: v for k, v in details.items() if v not in (None, "")},
            latitude=stay.latitude, longitude=stay.longitude, place_id=stay.place_id
        ))

    flights = db.query(Flight).filter(Flight.trip_id == trip.id).order_by(Flight.departs_at).all()
    for flight in flights:
        name = " ".join(part for part in (flight.airline, flight.flight_number) if part) or "Flight"
        details = {
            "from": f"{flight.from_name}" + (f" ({flight.from_code})" if flight.from_code else ""),
            "to": f"{flight.to_name}" + (f" ({flight.to_code})" if flight.to_code else ""),
            "departs_local_time": flight.departs_at.strftime("%a %d %b %H:%M"),
            "arrives_local_time": flight.arrives_at.strftime("%a %d %b %H:%M"),
        }
        # Each airport is a spot, so "how long from the airport to the hotel" can be answered
        for side, lat, lon, airport in (
            ("departure", flight.from_latitude, flight.from_longitude, flight.from_name),
            ("arrival", flight.to_latitude, flight.to_longitude, flight.to_name),
        ):
            spots.append(assistant.Spot(
                key=f"flight-{flight.id}-{side}", name=f"{name} {side}: {airport}", kind="flight",
                details={**details, "this_end": side}, latitude=lat, longitude=lon
            ))

    dates = f"{trip.start_date:%a %d %b %Y} to {trip.end_date:%a %d %b %Y}" if trip.start_date and trip.end_date else None
    return assistant.TripContext(
        title=trip.title, destination=trip.destination, dates=dates, currency=trip.currency, spots=spots
    )

@router.post("", response_model=AskResponse)
def ask_about_trip(
    trip_id: int,
    ask_request: AskRequest,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """Answer a question about the trip's saved places and plans. Anyone on the trip can ask."""
    rate_limit.hit(
        db,
        f"ask:{membership.user_id}",
        ASK_DAILY_LIMIT,
        timedelta(days=1),
        "You've asked a lot of questions today. Try again tomorrow."
    )

    context = trip_context(db, db.get(Trip, trip_id))
    try:
        answer = assistant.ask(ask_request.question.strip(), context)
    except assistant.AssistantError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error))

    mentions = []
    for spot in answer.mentioned:
        if spot.place_id is not None:
            mentions.append(AskMention(kind="place", id=spot.place_id, name=spot.name))
        elif spot.activity_id is not None:
            mentions.append(AskMention(kind="plan", id=spot.activity_id, name=spot.name))
    return AskResponse(answer=answer.text, mentions=mentions)
