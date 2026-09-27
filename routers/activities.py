from collections import defaultdict
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
import scheduling
import weather
from database import connect_db
from models import Trip, TripMembership, Activity, SavedLink, ExtractedPlace
from schemas import (
    ActivityCreate, ActivityUpdate, ActivityResponse, ItineraryResponse, ItineraryDay, ItineraryActivity,
    ScheduleWarning, SlotSuggestion, TravelLeg
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

@router.post("/activities", response_model=ActivityResponse, status_code=201)
def create_activity(
    trip_id: int,
    activity_create: ActivityCreate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    validate_activity(
        db,
        trip_id,
        activity_create.start_time,
        activity_create.end_time,
        activity_create.source_link_id
    )

    activity = Activity(
        trip_id=trip_id,
        **activity_create.model_dump()
    )

    db.add(activity)
    db.commit()
    db.refresh(activity)

    return activity

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

    update_data = activity_update.model_dump(
        exclude_unset=True
    )

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

def build_itinerary(db: Session, trip_id: int, activities: list[Activity], include_weather: bool = True) -> ItineraryResponse:
    days = defaultdict(list)
    conflict_count = 0

    place_ids = {activity.place_id for activity in activities if activity.place_id is not None}
    places = {
        place.id: place
        for place in db.query(ExtractedPlace).filter(ExtractedPlace.id.in_(place_ids)).all()
    } if place_ids else {}

    for activity in activities:
        days[activity.start_time.date()].append(
            ItineraryActivity.model_validate(activity)
        )

    for day_activities in days.values():
        # Activities are sorted by start time, so only later ones can overlap an earlier one
        for i, first in enumerate(day_activities):
            for second in day_activities[i + 1:]:
                if second.start_time >= first.end_time:
                    break
                first.conflicts_with.append(second.id)
                second.conflicts_with.append(first.id)
                conflict_count += 1

        previous, previous_point = None, None
        for activity in day_activities:
            place = places.get(activity.place_id)
            warning = hours_warning(activity, place)
            if warning is not None:
                activity.warnings.append(warning)

            point = coordinates(activity, place)
            if previous is not None and point is not None and previous_point is not None:
                minutes, mode, km = scheduling.travel_estimate(*previous_point, *point)
                activity.travel_from_previous = TravelLeg(minutes=minutes, mode=mode, km=km)
                gap = (activity.start_time - previous.end_time).total_seconds() / 60
                # Overlaps are already flagged as conflicts
                if 0 <= gap < minutes:
                    activity.warnings.append(ScheduleWarning(
                        kind="tight_travel",
                        message=f"About {minutes} min {'walk' if mode == 'walk' else 'by transit'} from {previous.title}, "
                                f"but only {int(gap)} min between them"
                    ))
            # A plan without a pin breaks the chain, since we can't tell where it is
            previous, previous_point = activity, point

    # One forecast for the trip, from the first plan with a map pin
    trip_point = next(
        (point for day_activities in days.values() for activity in day_activities
         if (point := coordinates(activity, places.get(activity.place_id))) is not None),
        None
    )
    forecasts = weather.forecast(*trip_point, list(days)) if trip_point and include_weather else {}

    return ItineraryResponse(
        trip_id=trip_id,
        days=[
            ItineraryDay(
                date=day,
                activities=day_activities,
                estimated_cost=sum(a.estimated_cost or 0 for a in day_activities),
                weather=forecasts.get(day)
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

    ranges = scheduling.hours_on(place.opening_hours, day) if place else None
    lat, lon = (place.latitude, place.longitude) if place else (None, None)
    slot = scheduling.suggest_slot(duration, busy, ranges, lat, lon)
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
