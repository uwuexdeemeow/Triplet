from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy.orm import Session
import booking_reader
import exchange_rates
import rate_limit
from database import connect_db
from models import Trip, TripMembership, Stay
from schemas import StayCreate, StayUpdate, StayResponse, StayDraft
from dependencies import get_trip_membership, require_role, EDITOR_ROLES
from photon_lookup import PhotonError, locate, suggest
from routers.places import get_place_or_404
from routers.users import avatar_content_type
from video_extractor import ExtractionError

router = APIRouter(
    prefix="/trips/{trip_id}/stays",
    tags=["Stays"]
)

# Like a saved screenshot: under the API's 1 MB request limit, and the app shrinks it first
BOOKING_MAX_BYTES = 900 * 1024
# Each read is an AI call, so cap them per person
BOOKING_READS_DAILY_LIMIT = 20

def short_date(day: date) -> str:
    return f"{day.day} {day:%b}"

def nights_problem(db: Session, trip: Trip, check_in: date, check_out: date, exclude_id: int | None = None) -> str | None:
    """Why a stay's nights don't work for the trip, or None if they do."""
    if check_out <= check_in:
        return "Check-out must be after check-in"
    # You can sleep somewhere the trip's last night and check out the morning after
    if check_in < trip.start_date or check_out > trip.end_date + timedelta(days=1):
        return f"The stay must be during the trip ({short_date(trip.start_date)} to {short_date(trip.end_date)})"

    # A night can only have one stay, so each day has one place to start and end
    clash = (
        db.query(Stay)
        .filter(
            Stay.trip_id == trip.id,
            Stay.id != (exclude_id or -1),
            Stay.check_in < check_out,
            Stay.check_out > check_in
        )
        .order_by(Stay.check_in)
        .first()
    )
    if clash is not None:
        return (f"Those nights overlap your stay at {clash.name} "
                f"({short_date(clash.check_in)} to {short_date(clash.check_out)})")
    return None

def get_stay_or_404(db: Session, trip_id: int, stay_id: int) -> Stay:
    stay = db.query(Stay).filter(Stay.id == stay_id, Stay.trip_id == trip_id).first()
    if stay is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stay not found"
        )
    return stay

@router.get("", response_model=list[StayResponse])
def get_stays(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    return db.query(Stay).filter(Stay.trip_id == trip_id).order_by(Stay.check_in, Stay.id).all()

@router.post("", response_model=StayResponse, status_code=201)
def create_stay(
    trip_id: int,
    stay_create: StayCreate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)
    trip = db.get(Trip, trip_id)

    problem = nights_problem(db, trip, stay_create.check_in, stay_create.check_out)
    if problem:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=problem)

    data = stay_create.model_dump()
    if stay_create.place_id is not None:
        place = get_place_or_404(db, trip_id, stay_create.place_id)
        # Made from a saved hotel: use its pin and address unless others were given
        if data["latitude"] is None and place.latitude is not None:
            data["latitude"], data["longitude"] = place.latitude, place.longitude
        data["address"] = data["address"] or place.address

    stay = Stay(trip_id=trip_id, **data)
    db.add(stay)
    db.commit()
    db.refresh(stay)
    return stay

@router.patch("/{stay_id}", response_model=StayResponse)
def update_stay(
    trip_id: int,
    stay_id: int,
    stay_update: StayUpdate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)
    stay = get_stay_or_404(db, trip_id, stay_id)

    # These columns are NOT NULL, so an explicit null means "leave unchanged"
    update_data = {
        field: value for field, value in stay_update.model_dump(exclude_unset=True).items()
        if not (value is None and field in ("name", "check_in", "check_out"))
    }

    problem = nights_problem(
        db, db.get(Trip, trip_id),
        update_data.get("check_in", stay.check_in),
        update_data.get("check_out", stay.check_out),
        exclude_id=stay.id
    )
    if problem:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=problem)

    for field, value in update_data.items():
        setattr(stay, field, value)
    db.commit()
    db.refresh(stay)
    return stay

@router.delete("/{stay_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stay(
    trip_id: int,
    stay_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)
    db.delete(get_stay_or_404(db, trip_id, stay_id))
    db.commit()

def find_pin(trip: Trip, booking: booking_reader.Booking) -> dict | None:
    """Where the booked place is: its name near the trip, or failing that its address."""
    near = trip.main_destination_pin
    queries = [
        " ".join(part for part in (booking.property_name, booking.city) if part),
        booking.address,
    ]
    try:
        for query in filter(None, queries):
            found = suggest(query.strip(), near, limit=1)
            if found:
                return found[0]
        if booking.address:
            point = locate(booking.address)
            if point:
                return {"latitude": point[0], "longitude": point[1], "address": None}
    except PhotonError:
        pass
    return None

# Sync, so the slow AI call runs in a worker thread instead of holding up other requests
@router.post("/read-booking", response_model=StayDraft)
def read_booking(
    trip_id: int,
    file: UploadFile,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """Read a booking confirmation screenshot into a stay for the person to check. Nothing is saved."""
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
    rate_limit.hit(
        db,
        f"booking-reads:{membership.user_id}",
        BOOKING_READS_DAILY_LIMIT,
        timedelta(days=1),
        "You've read a lot of bookings today. Try again tomorrow, or fill the stay in yourself."
    )

    trip = db.get(Trip, trip_id)
    try:
        booking = booking_reader.read_booking(data, trip.start_date, trip.end_date)
    except ExtractionError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error))
    if not booking.is_booking or not booking.property_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That doesn’t look like a hotel booking. Try a screenshot of the confirmation."
        )

    notes = []
    draft = StayDraft(
        name=booking.property_name.strip()[:255],
        address=(booking.address or "").strip()[:500] or None,
        check_in=booking_reader.parse_date(booking.check_in),
        check_out=booking_reader.parse_date(booking.check_out),
        confirmation=(booking.confirmation_number or "").strip()[:100] or None,
    )

    pin = find_pin(trip, booking)
    if pin:
        draft.latitude, draft.longitude = pin["latitude"], pin["longitude"]
        draft.address = draft.address or pin.get("address")
    else:
        notes.append("Couldn’t find it on the map. Search for it or drop a pin.")

    if booking.total_price is not None and booking.total_price >= 0:
        currency = (booking.currency or trip.currency).strip().upper()
        converted = exchange_rates.convert(booking.total_price, currency, trip.currency, exchange_rates.usd_rates())
        if converted is None:
            notes.append(f"The price is in {currency}, which couldn’t be converted to {trip.currency}. Add it yourself.")
        else:
            draft.cost = round(converted, 2)
            if currency != trip.currency:
                notes.append(f"The price was {booking.total_price:,.2f} {currency}, converted to {trip.currency}.")

    if draft.check_in is None or draft.check_out is None:
        notes.append("Couldn’t read both dates. Pick them below.")
    else:
        problem = nights_problem(db, trip, draft.check_in, draft.check_out)
        if problem:
            notes.append(problem + ".")

    draft.notes = notes
    return draft
