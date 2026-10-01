from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session
import airports
import booking_reader
import exchange_rates
import rate_limit
from database import connect_db
from models import Trip, TripMembership, Flight
from schemas import AirportResult, FlightCreate, FlightUpdate, FlightResponse, FlightDraft, FlightDrafts
from dependencies import get_trip_membership, require_role, EDITOR_ROLES
from routers.stays import BOOKING_MAX_BYTES, BOOKING_READS_DAILY_LIMIT, short_date
from routers.users import avatar_content_type
from validators import as_utc
from video_extractor import ExtractionError

router = APIRouter(
    prefix="/trips/{trip_id}/flights",
    tags=["Flights"]
)

# Longer than any flight, even with the clocks going back across the date line
LONGEST_FLIGHT = timedelta(hours=36)

def flight_problem(trip: Trip, departs_at: datetime, arrives_at: datetime) -> str | None:
    """Why a flight's times don't work for the trip, or None if they do."""
    departs, arrives = as_utc(departs_at), as_utc(arrives_at)
    # Each time is its own airport's clock, so landing "before" take-off can be right (flying east
    # over the date line), but not by more than a day either way
    if not -timedelta(hours=24) <= arrives - departs <= LONGEST_FLIGHT:
        return "Check the times: the flight can’t take that long"
    # Flying in the day before or home the day after still belongs to the trip
    if departs.date() > trip.end_date + timedelta(days=1) or arrives.date() < trip.start_date - timedelta(days=1):
        return f"The flight must be around the trip ({short_date(trip.start_date)} to {short_date(trip.end_date)})"
    return None

def fill_airports(data: dict) -> dict:
    """Use a known airport's name and pin when only its code was given."""
    for side in ("from", "to"):
        code = data.get(f"{side}_code")
        if not code or data.get(f"{side}_latitude") is not None:
            continue
        airport = airports.by_code(code)
        if airport:
            data[f"{side}_latitude"], data[f"{side}_longitude"] = airport["latitude"], airport["longitude"]
    return data

def get_flight_or_404(db: Session, trip_id: int, flight_id: int) -> Flight:
    flight = db.query(Flight).filter(Flight.id == flight_id, Flight.trip_id == trip_id).first()
    if flight is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Flight not found"
        )
    return flight

@router.get("", response_model=list[FlightResponse])
def get_flights(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    return db.query(Flight).filter(Flight.trip_id == trip_id).order_by(Flight.departs_at, Flight.id).all()

@router.get("/airports", response_model=list[AirportResult])
def search_airports(
    trip_id: int,
    q: str = Query(min_length=2, max_length=100),
    membership: TripMembership = Depends(get_trip_membership)
):
    """Airports by code, name or city, e.g. "HND", "Haneda" or "Tokyo". From a list kept with the app."""
    return airports.search(q)

@router.post("", response_model=FlightResponse, status_code=201)
def create_flight(
    trip_id: int,
    flight_create: FlightCreate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)
    problem = flight_problem(db.get(Trip, trip_id), flight_create.departs_at, flight_create.arrives_at)
    if problem:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=problem)

    flight = Flight(trip_id=trip_id, **fill_airports(flight_create.model_dump()))
    db.add(flight)
    db.commit()
    db.refresh(flight)
    return flight

@router.patch("/{flight_id}", response_model=FlightResponse)
def update_flight(
    trip_id: int,
    flight_id: int,
    flight_update: FlightUpdate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)
    flight = get_flight_or_404(db, trip_id, flight_id)

    # These columns are NOT NULL, so an explicit null means "leave unchanged"
    update_data = {
        field: value for field, value in flight_update.model_dump(exclude_unset=True).items()
        if not (value is None and field in ("from_name", "to_name", "departs_at", "arrives_at"))
    }
    problem = flight_problem(
        db.get(Trip, trip_id),
        update_data.get("departs_at", flight.departs_at),
        update_data.get("arrives_at", flight.arrives_at)
    )
    if problem:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=problem)

    for field, value in fill_airports(update_data).items():
        setattr(flight, field, value)
    db.commit()
    db.refresh(flight)
    return flight

@router.delete("/{flight_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_flight(
    trip_id: int,
    flight_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)
    db.delete(get_flight_or_404(db, trip_id, flight_id))
    db.commit()

def airport_side(name: str | None, code: str | None) -> dict:
    """A ticket's airport as the form wants it: our listed name and pin when the code is known."""
    known = airports.by_code(code) if code and len(code.strip()) == 3 else None
    if known:
        return {"name": known["name"], "code": known["code"], "latitude": known["latitude"], "longitude": known["longitude"]}
    return {"name": (name or "").strip()[:255] or None, "code": None, "latitude": None, "longitude": None}

# Sync, so the slow AI call runs in a worker thread instead of holding up other requests
@router.post("/read-ticket", response_model=FlightDrafts)
def read_ticket(
    trip_id: int,
    file: UploadFile,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """Read an e-ticket or booking screenshot into flights for the person to check. Nothing is saved."""
    require_role(membership, EDITOR_ROLES)

    data = file.file.read(BOOKING_MAX_BYTES + 1)
    if len(data) > BOOKING_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="That screenshot is too big. Try a smaller one."
        )
    if avatar_content_type(data) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Use a JPEG, PNG or WebP image"
        )
    # One allowance for reading hotel bookings and tickets
    rate_limit.hit(
        db,
        f"booking-reads:{membership.user_id}",
        BOOKING_READS_DAILY_LIMIT,
        timedelta(days=1),
        "You've read a lot of bookings today. Try again tomorrow, or fill the flight in yourself."
    )

    trip = db.get(Trip, trip_id)
    try:
        booking = booking_reader.read_flight_booking(data, trip.start_date, trip.end_date)
    except ExtractionError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error))
    legs = [leg for leg in booking.flights if leg.from_code or leg.from_airport or leg.to_code or leg.to_airport][:8]
    if not booking.is_flight_booking or not legs:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That doesn’t look like a flight booking. Try a screenshot of the e-ticket or confirmation."
        )

    notes = []
    confirmation = (booking.confirmation_number or "").strip()[:100] or None
    drafts = []
    for leg in legs:
        start, end = airport_side(leg.from_airport, leg.from_code), airport_side(leg.to_airport, leg.to_code)
        drafts.append(FlightDraft(
            flight_number=(leg.flight_number or "").strip()[:20] or None,
            airline=(leg.airline or "").strip()[:100] or None,
            from_name=start["name"], from_code=start["code"], from_latitude=start["latitude"], from_longitude=start["longitude"],
            to_name=end["name"], to_code=end["code"], to_latitude=end["latitude"], to_longitude=end["longitude"],
            departs_at=booking_reader.parse_local_time(leg.departs_local),
            arrives_at=booking_reader.parse_local_time(leg.arrives_local),
            confirmation=confirmation,
        ))

    if booking.total_price is not None and booking.total_price >= 0:
        currency = (booking.currency or trip.currency).strip().upper()
        converted = exchange_rates.convert(booking.total_price, currency, trip.currency, exchange_rates.usd_rates())
        if converted is None:
            notes.append(f"The price is in {currency}, which couldn’t be converted to {trip.currency}. Add it yourself.")
        else:
            # The ticket's total, shared evenly between its flights
            for draft in drafts:
                draft.cost = round(converted / len(drafts), 2)
            if currency != trip.currency:
                notes.append(f"The price was {booking.total_price:,.2f} {currency}, converted to {trip.currency}.")
            if len(drafts) > 1:
                notes.append(f"The total is split evenly between the {len(drafts)} flights.")

    for index, draft in enumerate(drafts, start=1):
        which = f"Flight {index}" if len(drafts) > 1 else "The flight"
        if draft.departs_at is None or draft.arrives_at is None:
            notes.append(f"{which}: couldn’t read both times. Fill them in.")
        elif problem := flight_problem(trip, draft.departs_at, draft.arrives_at):
            notes.append(f"{which}: {problem[0].lower()}{problem[1:]}.")
        if draft.from_latitude is None or draft.to_latitude is None:
            notes.append(f"{which}: pick the airports, so the plan can find the way to them.")

    return FlightDrafts(flights=drafts, notes=notes)
