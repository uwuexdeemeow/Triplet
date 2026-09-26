from collections import defaultdict
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from models import Trip, TripMembership, Activity, SavedLink
from schemas import ActivityCreate, ActivityUpdate, ActivityResponse, ItineraryResponse, ItineraryDay, ItineraryActivity
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

def build_itinerary(trip_id: int, activities: list[Activity]) -> ItineraryResponse:
    days = defaultdict(list)
    conflict_count = 0

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

    return ItineraryResponse(
        trip_id=trip_id,
        days=[
            ItineraryDay(
                date=day,
                activities=day_activities,
                estimated_cost=sum(a.estimated_cost or 0 for a in day_activities)
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

    return build_itinerary(trip_id, activities)
