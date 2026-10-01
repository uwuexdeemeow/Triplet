from collections import defaultdict
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
import scheduling
import weather
from database import connect_db
from models import Trip, TripMembership, Activity, SavedLink, ExtractedPlace, Stay, Flight
from schemas import (
    ActivityCreate, ActivityUpdate, ActivityResponse, ItineraryResponse, ItineraryDay, ItineraryActivity,
    ItineraryFlight, ScheduleWarning, SlotSuggestion, StayStop, TravelLeg
)
from dependencies import get_trip_membership, require_role, EDITOR_ROLES, Pagination
from validators import as_utc

router = APIRouter(
    prefix="/trips/{trip_id}",
    tags=["Activities"]
)

def validate_activity(db: Session, trip_id: int, start_time: datetime, end_time: datetime, source_link_id: int | None):
    if as_utc(end_time) < as_utc(start_time):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="End time cannot be before start time"
        )

    trip = db.query(Trip).filter(Trip.id == trip_id).first()

    if not (trip.start_date <= start_time.date() <= trip.end_date):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Activity must take place during the trip"
        )

    if source_link_id is not None:
        link = db.query(SavedLink).filter(
            SavedLink.id == source_link_id,
            SavedLink.trip_id == trip_id
        ).first()

        if link is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Saved link not found"
            )

def get_activity_or_404(db: Session, trip_id: int, activity_id: int) -> Activity:
    activity = db.query(Activity).filter(
        Activity.id == activity_id,
        Activity.trip_id == trip_id
    ).first()

    if activity is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Activity not found"
        )

    return activity

def add_activity(db: Session, trip_id: int, data: dict) -> Activity:
    """Checks and saves a new plan. Also used by guests the owner lets add plans."""
    validate_activity(db, trip_id, data["start_time"], data["end_time"], data.get("source_link_id"))

    activity = Activity(trip_id=trip_id, **data)

    db.add(activity)
    db.commit()
    db.refresh(activity)

    return activity

def change_activity(db: Session, trip_id: int, activity: Activity, update_data: dict) -> Activity:
    """Checks and saves the fields that were sent. Also used by guests the owner lets change plans."""
    # These columns are NOT NULL, so an explicit null means "leave unchanged"
    required_fields = ["title", "location", "start_time", "end_time"]
    update_data = {
        field: value for field, value in update_data.items()
        if not (value is None and field in required_fields)
    }

    validate_activity(
        db,
        trip_id,
        update_data.get("start_time", activity.start_time),
        update_data.get("end_time", activity.end_time),
        update_data.get("source_link_id")
    )

    for field, value in update_data.items():
        setattr(activity, field, value)

    db.commit()
    db.refresh(activity)

    return activity

@router.post("/activities", response_model=ActivityResponse, status_code=201)
def create_activity(
    trip_id: int,
    activity_create: ActivityCreate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    return add_activity(db, trip_id, activity_create.model_dump())

@router.get("/activities", response_model=list[ActivityResponse])
def get_activities(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership),
    pagination: Pagination = Depends()
):
    activities = (
        db.query(Activity)
        .filter(Activity.trip_id == trip_id)
        .order_by(Activity.start_time, Activity.id)
        .limit(pagination.limit)
        .offset(pagination.offset)
        .all()
    )

    return activities

@router.get("/activities/{activity_id}", response_model=ActivityResponse)
def get_activity(
    trip_id: int,
    activity_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    return get_activity_or_404(db, trip_id, activity_id)

@router.patch("/activities/{activity_id}", response_model=ActivityResponse)
def update_activity(
    trip_id: int,
    activity_id: int,
    activity_update: ActivityUpdate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    activity = get_activity_or_404(db, trip_id, activity_id)

    return change_activity(db, trip_id, activity, activity_update.model_dump(exclude_unset=True))

@router.delete("/activities/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_activity(
    trip_id: int,
    activity_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    activity = get_activity_or_404(db, trip_id, activity_id)

    db.delete(activity)
    db.commit()

def coordinates(activity: ActivityResponse, place: ExtractedPlace | None) -> tuple[float, float] | None:
    # A pin dropped on the plan wins over the place's own
    if activity.latitude is not None and activity.longitude is not None:
        return activity.latitude, activity.longitude
    if place is not None and place.latitude is not None and place.longitude is not None:
        return place.latitude, place.longitude
    return None

def hours_warning(activity: ActivityResponse, place: ExtractedPlace | None) -> ScheduleWarning | None:
    if place is None:
        return None
    day = activity.start_time.date()
    ranges = scheduling.hours_on(place.opening_hours, day)
    if ranges is None:
        return None
    if not ranges:
        return ScheduleWarning(kind="closed", message=f"{place.name} is closed on {day.strftime('%A')}s")

    start = scheduling.minutes_of(activity.start_time)
    # Plans that run past midnight are checked up to the end of the day
    end = scheduling.minutes_of(activity.end_time) if activity.end_time.date() == day else scheduling.DAY_MINUTES
    if scheduling.is_open_during(ranges, start, max(end, start)):
        return None
    return ScheduleWarning(kind="outside_hours", message=f"Open {scheduling.format_ranges(ranges)} that day")

def stays_by_night(db: Session, trip_id: int) -> dict[date, Stay]:
    """Each night of the trip that has a stay booked, by its date (the night of 3 Oct is 3 Oct)."""
    nights = {}
    for stay in db.query(Stay).filter(Stay.trip_id == trip_id).all():
        night = stay.check_in
        while night < stay.check_out:
            nights[night] = stay
            night += timedelta(days=1)
    return nights

def stay_point(stay: Stay | None) -> tuple[float, float] | None:
    if stay is None or stay.latitude is None or stay.longitude is None:
        return None
    return stay.latitude, stay.longitude

def stay_stop(stay: Stay | None) -> StayStop | None:
    if stay is None:
        return None
    return StayStop(id=stay.id, name=stay.name, address=stay.address, latitude=stay.latitude, longitude=stay.longitude)

# Be at the airport this long before take-off, for check-in, bags and security
AIRPORT_BEFORE_MINUTES = 120
# And roughly this long after landing to get out: walking, passport control, bags
AIRPORT_AFTER_MINUTES = 45

def flight_label(flight) -> str:
    return f"flight {flight.flight_number}" if flight.flight_number else "flight"

def flights_by_day(db: Session, trip_id: int) -> dict[date, list[ItineraryFlight]]:
    """Each flight's take-off and landing, on the day each happens, in time order."""
    events = defaultdict(list)
    for flight in db.query(Flight).filter(Flight.trip_id == trip_id).order_by(Flight.departs_at, Flight.id).all():
        common = {"flight_id": flight.id, "flight_number": flight.flight_number, "airline": flight.airline}
        events[flight.departs_at.date()].append(ItineraryFlight(
            **common, kind="departure",
            airport=flight.from_name, airport_code=flight.from_code,
            latitude=flight.from_latitude, longitude=flight.from_longitude,
            other_airport=flight.to_name, other_airport_code=flight.to_code,
            time=flight.departs_at, ready_at=flight.departs_at - timedelta(minutes=AIRPORT_BEFORE_MINUTES)
        ))
        events[flight.arrives_at.date()].append(ItineraryFlight(
            **common, kind="arrival",
            airport=flight.to_name, airport_code=flight.to_code,
            latitude=flight.to_latitude, longitude=flight.to_longitude,
            other_airport=flight.from_name, other_airport_code=flight.from_code,
            time=flight.arrives_at, ready_at=flight.arrives_at + timedelta(minutes=AIRPORT_AFTER_MINUTES)
        ))
    for day_events in events.values():
        day_events.sort(key=lambda event: (event.time, event.kind == "departure"))
    return events

def flight_windows(events: list[ItineraryFlight]) -> list[tuple[datetime, datetime, ItineraryFlight]]:
    """When a day's flights keep you busy: at the airport, or in the air until midnight or since it."""
    windows = []
    for event in events:
        if event.kind == "departure":
            landing = next((e for e in events if e.kind == "arrival" and e.flight_id == event.flight_id), None)
            end = landing.ready_at if landing else event.time.replace(hour=23, minute=59)
            windows.append((event.ready_at, end, event))
        elif not any(e.kind == "departure" and e.flight_id == event.flight_id for e in events):
            # Took off the day before: in the air since midnight
            windows.append((event.time.replace(hour=0, minute=0), event.ready_at, event))
    return windows

def flight_busy(db: Session, trip_id: int) -> dict[date, list[tuple[int, int, float | None, float | None]]]:
    """Each day's flight times as busy (start, end, latitude, longitude) in minutes, for suggesting times around them."""
    busy = defaultdict(list)
    for day, events in flights_by_day(db, trip_id).items():
        for start, end, event in flight_windows(events):
            start_minutes = scheduling.minutes_of(start) if start.date() == day else 0
            end_minutes = scheduling.minutes_of(end) if end.date() == day else scheduling.DAY_MINUTES
            busy[day].append((start_minutes, max(end_minutes, start_minutes), event.latitude, event.longitude))
    return busy

def build_itinerary(db: Session, trip_id: int, activities: list[Activity], include_weather: bool = True) -> ItineraryResponse:
    days = defaultdict(list)
    conflict_count = 0

    # A day starts where you slept the night before and ends where you sleep that night
    nights = stays_by_night(db, trip_id)
    # And the day you fly starts or ends at the airport
    flights = flights_by_day(db, trip_id)
    trip = db.get(Trip, trip_id)
    if (nights or flights) and trip is not None:
        day = trip.start_date
        while day <= trip.end_date:
            if day in nights or day - timedelta(days=1) in nights or day in flights:
                # Days with nothing planned still show where they start and end
                days[day]
            day += timedelta(days=1)

    place_ids = {activity.place_id for activity in activities if activity.place_id is not None}
    places = {
        place.id: place
        for place in db.query(ExtractedPlace).filter(ExtractedPlace.id.in_(place_ids)).all()
    } if place_ids else {}

    link_ids = {activity.source_link_id for activity in activities if activity.source_link_id is not None}
    platforms = dict(
        db.query(SavedLink.id, SavedLink.platform).filter(SavedLink.id.in_(link_ids)).all()
    ) if link_ids else {}

    for activity in activities:
        item = ItineraryActivity.model_validate(activity)
        item.source_platform = platforms.get(activity.source_link_id)
        days[activity.start_time.date()].append(item)

    travel_to_stay: dict[date, TravelLeg] = {}
    for day, day_activities in days.items():
        # Activities are sorted by start time, so only later ones can overlap an earlier one
        for i, first in enumerate(day_activities):
            for second in day_activities[i + 1:]:
                if second.start_time >= first.end_time:
                    break
                first.conflicts_with.append(second.id)
                second.conflicts_with.append(first.id)
                conflict_count += 1

        day_flights = flights.get(day, [])
        windows = flight_windows(day_flights)

        # The day's plans and flights in order: a take-off counts from when you need to be at the airport
        entries = sorted(
            [(activity.start_time, 1, activity) for activity in day_activities]
            + [(event.ready_at if event.kind == "departure" else event.time, 0, event) for event in day_flights],
            key=lambda entry: (entry[0], entry[1])
        )

        # The day's first trip is from last night's stay. `previous_end` is when you can leave the
        # stop before (None for the hotel, where there's no rush), and `previous_name` what it's called.
        previous_point = stay_point(nights.get(day - timedelta(days=1)))
        previous_end, previous_name = None, None
        for _, _, entry in entries:
            if isinstance(entry, ItineraryFlight):
                point = (entry.latitude, entry.longitude) if entry.latitude is not None and entry.longitude is not None else None
                if entry.kind == "departure":
                    if point is not None and previous_point is not None:
                        travel = scheduling.travel_between(*previous_point, *point, depart=previous_end or entry.ready_at)
                        gap = (entry.ready_at - previous_end).total_seconds() / 60 if previous_end else None
                        entry.travel_from_previous = TravelLeg(
                            minutes=travel.minutes, mode=travel.mode, km=travel.km, note=travel.note,
                            leave_by=entry.ready_at - timedelta(minutes=travel.minutes)
                            if gap is None or gap >= travel.minutes else None
                        )
                        if gap is not None and gap < travel.minutes:
                            entry.warnings.append(ScheduleWarning(
                                kind="tight_travel",
                                message=f"About {travel.minutes} min to the airport from {previous_name}, but you "
                                        f"should be there by {scheduling.format_clock(scheduling.minutes_of(entry.ready_at))}"
                            ))
                    # In the air: nowhere to travel on from until it lands
                    previous_point, previous_end, previous_name = None, entry.time, None
                else:
                    previous_point, previous_end, previous_name = point, entry.ready_at, entry.airport
                continue

            activity = entry
            place = places.get(activity.place_id)
            warning = hours_warning(activity, place)
            if warning is not None:
                activity.warnings.append(warning)
            for window_start, window_end, event in windows:
                if activity.start_time < window_end and window_start < activity.end_time:
                    clock = scheduling.format_clock(scheduling.minutes_of(event.ready_at))
                    when = f"be at {event.airport} by {clock}" if event.kind == "departure" else f"out of {event.airport} around {clock}"
                    activity.warnings.append(ScheduleWarning(
                        kind="flight", message=f"Clashes with your {flight_label(event)} ({when})"
                    ))
                    break

            point = coordinates(activity, place)
            if previous_end is None and point is not None and previous_point is not None:
                # Arriving on time is all that matters from the hotel, so there's no gap to check
                travel = scheduling.travel_between(*previous_point, *point, depart=activity.start_time)
                activity.travel_from_previous = TravelLeg(
                    minutes=travel.minutes, mode=travel.mode, km=travel.km, note=travel.note,
                    leave_by=activity.start_time - timedelta(minutes=travel.minutes)
                )
            elif previous_end is not None and point is not None and previous_point is not None:
                # Leaving when the stop before ends, so rush hour and late nights count
                travel = scheduling.travel_between(*previous_point, *point, depart=previous_end)
                minutes = travel.minutes
                gap = (activity.start_time - previous_end).total_seconds() / 60
                activity.travel_from_previous = TravelLeg(
                    minutes=minutes, mode=travel.mode, km=travel.km, note=travel.note,
                    # When to set off to arrive on time, if there's room for the trip
                    leave_by=activity.start_time - timedelta(minutes=minutes) if gap >= minutes else None
                )
                # Overlaps are already flagged as conflicts
                if 0 <= gap < minutes:
                    how = "walk" if travel.mode == "walk" else "by transit"
                    when = f" in {travel.note}" if travel.note == "rush hour" else ""
                    activity.warnings.append(ScheduleWarning(
                        kind="tight_travel",
                        message=f"About {minutes} min {how}{when} from {previous_name}, "
                                f"but only {int(gap)} min between them"
                    ))
            # A plan without a pin breaks the chain, since we can't tell where it is
            previous_point, previous_end, previous_name = point, activity.end_time, activity.title

        # And back to where you sleep tonight after the last plan (or landing)
        tonight = stay_point(nights.get(day))
        if previous_end is not None and previous_point is not None and tonight is not None:
            travel = scheduling.travel_between(*previous_point, *tonight, depart=previous_end)
            travel_to_stay[day] = TravelLeg(minutes=travel.minutes, mode=travel.mode, km=travel.km, note=travel.note)

    # One forecast for the trip, from the first plan with a map pin
    trip_point = next(
        (point for day_activities in days.values() for activity in day_activities
         if (point := coordinates(activity, places.get(activity.place_id))) is not None),
        None
    ) or next((point for stay in nights.values() if (point := stay_point(stay)) is not None), None)
    forecasts = weather.forecast(*trip_point, list(days)) if trip_point and include_weather else {}

    return ItineraryResponse(
        trip_id=trip_id,
        days=[
            ItineraryDay(
                date=day,
                activities=day_activities,
                estimated_cost=sum(a.estimated_cost or 0 for a in day_activities),
                weather=forecasts.get(day),
                start_stay=stay_stop(nights.get(day - timedelta(days=1))),
                end_stay=stay_stop(nights.get(day)),
                travel_to_stay=travel_to_stay.get(day),
                flights=flights.get(day, [])
            )
            for day, day_activities in sorted(days.items())
        ],
        conflict_count=conflict_count
    )

@router.get("/itinerary", response_model=ItineraryResponse)
def get_itinerary(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    activities = (
        db.query(Activity)
        .filter(Activity.trip_id == trip_id)
        .order_by(Activity.start_time, Activity.id)
        .all()
    )

    return build_itinerary(db, trip_id, activities)

@router.get("/schedule/suggest", response_model=SlotSuggestion | None)
def suggest_time(
    trip_id: int,
    day: date = Query(alias="date"),
    duration: int = Query(default=60, ge=15, le=12 * 60),
    place_id: int | None = None,
    exclude_activity_id: int | None = None,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """The earliest time on a day when the place is open and there's time to get there."""
    place = None
    if place_id is not None:
        place = db.query(ExtractedPlace).join(SavedLink, SavedLink.id == ExtractedPlace.link_id).filter(
            ExtractedPlace.id == place_id,
            SavedLink.trip_id == trip_id
        ).first()
        if place is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Place not found"
            )

    start_of_day = datetime(day.year, day.month, day.day)
    others = (
        db.query(Activity)
        .filter(
            Activity.trip_id == trip_id,
            Activity.start_time >= start_of_day,
            Activity.start_time < start_of_day + timedelta(days=1),
            Activity.id != (exclude_activity_id or -1)
        )
        .all()
    )
    other_places = {
        p.id: p for p in db.query(ExtractedPlace).filter(
            ExtractedPlace.id.in_({a.place_id for a in others if a.place_id is not None})
        ).all()
    }
    busy = []
    for other in others:
        point = coordinates(ActivityResponse.model_validate(other), other_places.get(other.place_id)) or (None, None)
        end = scheduling.minutes_of(other.end_time) if other.end_time.date() == day else scheduling.DAY_MINUTES
        busy.append((scheduling.minutes_of(other.start_time), end, *point))

    # Flights that day are busy too: at the airport, or in the air
    busy.extend(flight_busy(db, trip_id).get(day, []))

    ranges = scheduling.hours_on(place.opening_hours, day) if place else None
    lat, lon = (place.latitude, place.longitude) if place else (None, None)
    slot = scheduling.suggest_slot(duration, busy, ranges, lat, lon, day)
    if slot is None:
        return None

    if ranges:
        reason = f"Open {scheduling.format_ranges(ranges)}, and free then"
    else:
        reason = "Free then" + (" with time to get there" if lat is not None and busy else "")
    return SlotSuggestion(
        start_time=scheduling.at(day, slot[0]),
        end_time=scheduling.at(day, slot[1]),
        reason=reason
    )
