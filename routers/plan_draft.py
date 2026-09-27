from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import planner
import scheduling
from database import connect_db
from models import Trip, TripMembership, SavedLink, ExtractedPlace, Activity, User
from schemas import ActivityResponse, LinkToActivity, PlanDraftApply, PlanDraftResponse, PlanDraftItem, PlanDraftSkipped
from dependencies import get_trip_membership, require_role, EDITOR_ROLES
from routers.links import new_activity_from_link

router = APIRouter(
    prefix="/trips/{trip_id}/plan-draft",
    tags=["Plan draft"]
)

def trip_days(trip: Trip):
    if trip.start_date is None or trip.end_date is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Add the trip's dates first"
        )
    return [trip.start_date + timedelta(days=i) for i in range((trip.end_date - trip.start_date).days + 1)]

@router.post("", response_model=PlanDraftResponse)
def draft_plan(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """
    Suggest where every saved place could go, merging places several people saved.
    Nothing changes until the draft is applied.
    """
    require_role(membership, EDITOR_ROLES)
    days = trip_days(db.get(Trip, trip_id))

    rows = (
        db.query(ExtractedPlace, User.name)
        .join(SavedLink, SavedLink.id == ExtractedPlace.link_id)
        .outerjoin(User, User.id == SavedLink.added_by_id)
        .filter(SavedLink.trip_id == trip_id)
        .order_by(ExtractedPlace.id)
        .all()
    )
    activities = db.query(Activity).filter(Activity.trip_id == trip_id).all()
    planned_place_ids = {activity.place_id for activity in activities if activity.place_id is not None}
    places_by_id = {place.id: place for place, _ in rows}

    candidates = [
        planner.Candidate(
            place_id=place.id,
            name=place.name,
            category=place.category,
            latitude=place.latitude,
            longitude=place.longitude,
            opening_hours=place.opening_hours,
            saved_by=saved_by,
            planned=place.id in planned_place_ids
        )
        for place, saved_by in rows
    ]

    planned = []
    for activity in activities:
        place = places_by_id.get(activity.place_id)
        lat = activity.latitude if activity.latitude is not None else (place.latitude if place else None)
        lon = activity.longitude if activity.longitude is not None else (place.longitude if place else None)
        day = activity.start_time.date()
        end = scheduling.minutes_of(activity.end_time) if activity.end_time.date() == day else scheduling.DAY_MINUTES
        planned.append(planner.Busy(day, scheduling.minutes_of(activity.start_time), end, lat, lon))

    draft = planner.draft_plan(days, candidates, planned)

    return PlanDraftResponse(
        items=[
            PlanDraftItem(
                place_id=proposal.place_id,
                name=proposal.name,
                start_time=scheduling.at(proposal.day, proposal.start),
                end_time=scheduling.at(proposal.day, proposal.end),
                saved_by=proposal.saved_by,
                merged_place_ids=proposal.merged_place_ids,
                reason=proposal.reason
            )
            for proposal in draft.proposals
        ],
        skipped=[PlanDraftSkipped(place_id=u.place_id, name=u.name, reason=u.reason) for u in draft.unplaced],
        merged_count=draft.merged_count
    )

@router.post("/apply", response_model=list[ActivityResponse], status_code=201)
def apply_draft(
    trip_id: int,
    plan_draft_apply: PlanDraftApply,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """Add the draft items the user kept to the plan, all at once."""
    require_role(membership, EDITOR_ROLES)

    place_ids = [item.place_id for item in plan_draft_apply.items]
    rows = {
        place.id: (place, link)
        for place, link in (
            db.query(ExtractedPlace, SavedLink)
            .join(SavedLink, SavedLink.id == ExtractedPlace.link_id)
            .filter(SavedLink.trip_id == trip_id, ExtractedPlace.id.in_(place_ids))
            .all()
        )
    }

    activities = []
    for item in plan_draft_apply.items:
        if item.place_id not in rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Place not found"
            )
        place, link = rows[item.place_id]
        activities.append(new_activity_from_link(
            db, trip_id, link, place,
            LinkToActivity(place_id=place.id, start_time=item.start_time, end_time=item.end_time)
        ))

    # All or nothing, so a bad item doesn't leave half the draft in the plan
    db.add_all(activities)
    db.commit()
    for activity in activities:
        db.refresh(activity)

    return activities
