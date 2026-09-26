from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from models import TripMembership, SavedLink, Activity
from schemas import SavedLinkCreate, SavedLinkUpdate, SavedLinkResponse, LinkToActivity, ActivityResponse
from dependencies import get_trip_membership, require_role, EDITOR_ROLES
from link_parser import parse_link
from routers.activities import validate_activity

router = APIRouter(
    prefix="/trips/{trip_id}/links",
    tags=["Saved Links"]
)

def get_link_or_404(db: Session, trip_id: int, link_id: int) -> SavedLink:
    link = db.query(SavedLink).filter(
        SavedLink.id == link_id,
        SavedLink.trip_id == trip_id
    ).first()

    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Saved link not found"
        )

    return link

@router.post("", response_model=SavedLinkResponse, status_code=201)
def create_link(
    trip_id: int,
    link_create: SavedLinkCreate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    url = str(link_create.url)

    link = SavedLink(
        trip_id=trip_id,
        added_by_id=membership.user_id,
        url=url,
        place_name=link_create.place_name,
        notes=link_create.notes,
        **parse_link(url)
    )

    db.add(link)
    db.commit()
    db.refresh(link)

    return link

@router.get("", response_model=list[SavedLinkResponse])
def get_links(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    links = (
        db.query(SavedLink)
        .filter(SavedLink.trip_id == trip_id)
        .order_by(SavedLink.created_at.desc())
        .all()
    )

    return links

@router.get("/{link_id}", response_model=SavedLinkResponse)
def get_link(
    trip_id: int,
    link_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    return get_link_or_404(db, trip_id, link_id)

@router.patch("/{link_id}", response_model=SavedLinkResponse)
def update_link(
    trip_id: int,
    link_id: int,
    link_update: SavedLinkUpdate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    link = get_link_or_404(db, trip_id, link_id)

    update_data = link_update.model_dump(
        exclude_unset=True
    )

    for field, value in update_data.items():
        setattr(link, field, value)

    db.commit()
    db.refresh(link)

    return link

@router.post("/{link_id}/refresh", response_model=SavedLinkResponse)
def refresh_link(
    trip_id: int,
    link_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    link = get_link_or_404(db, trip_id, link_id)

    for field, value in parse_link(link.url).items():
        setattr(link, field, value)

    db.commit()
    db.refresh(link)

    return link

@router.delete("/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_link(
    trip_id: int,
    link_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    link = get_link_or_404(db, trip_id, link_id)

    db.delete(link)
    db.commit()

@router.post("/{link_id}/activity", response_model=ActivityResponse, status_code=201)
def add_link_to_itinerary(
    trip_id: int,
    link_id: int,
    link_to_activity: LinkToActivity,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    link = get_link_or_404(db, trip_id, link_id)

    title = link_to_activity.title or link.place_name or link.title
    location = link_to_activity.location or link.place_name

    if not title or not location:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Title and location are required"
        )

    validate_activity(
        db,
        trip_id,
        link_to_activity.start_time,
        link_to_activity.end_time,
        link.id
    )

    # Keep a reference back to the original post so users remember why they saved it
    activity = Activity(
        trip_id=trip_id,
        source_link_id=link.id,
        title=title[:255],
        description=link_to_activity.description or link.notes,
        location=location,
        start_time=link_to_activity.start_time,
        end_time=link_to_activity.end_time,
        estimated_cost=link_to_activity.estimated_cost
    )

    db.add(activity)
    db.commit()
    db.refresh(activity)

    return activity
