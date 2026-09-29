import hashlib
import hmac
import logging
import threading
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session, selectinload
from config import settings
from database import connect_db, SessionLocal
from models import Trip, TripMembership, SavedLink, ExtractedPlace, Activity, LinkImage
from schemas import SavedLinkCreate, SavedLinkUpdate, SavedLinkResponse, LinkToActivity, ActivityResponse
from dependencies import get_trip_membership, require_role, EDITOR_ROLES, Pagination
import rate_limit
from link_parser import detect_platform, fetch_metadata, post_key, ARTICLE, SCREENSHOT, VIDEO_PLATFORMS
from video_extractor import extract_from_images, extract_from_text, extract_from_video, ExtractionError, ExtractionResult
from web_extractor import fetch_article, ArticleError
from places_lookup import enrich_place
from routers.activities import validate_activity
from routers.users import avatar_content_type

logger = logging.getLogger("triplet.links")

def fit_to_columns(values: dict) -> dict:
    """Cut AI generated text down to the column sizes so an overly long value can't fail the insert."""
    fitted = {}
    for field, value in values.items():
        column = ExtractedPlace.__table__.columns[field]
        max_length = getattr(column.type, "length", None)
        fitted[field] = value[:max_length] if isinstance(value, str) and max_length else value
    return fitted

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

def read_places(db: Session, link: SavedLink) -> ExtractionResult:
    """Find the places in a saved post, however it was saved: a video post, a screenshot or an article."""
    if link.platform == SCREENSHOT:
        image = db.get(LinkImage, link.id)
        if image is None:
            raise ExtractionError("The screenshot is missing. Try adding it again.")
        return extract_from_images([image.data])
    if link.platform == ARTICLE:
        article = fetch_article(link.url)
        # Articles have no oEmbed details, so take them from the page itself
        link.title = link.title or (article.title or "")[:500] or None
        link.author_name = link.author_name or (article.site_name or "")[:255] or None
        link.thumbnail_url = link.thumbnail_url or (article.image_url or "")[:2048] or None
        text = f"{article.title}\n\n{article.text}" if article.title else article.text
        return extract_from_text(text, link.url)
    return extract_from_video(link.url)

# Reading a post downloads it and hands it to the AI, which is what takes memory, so only a
# couple run at once and the rest wait their turn. Looking up addresses afterwards isn't counted.
_reading = threading.BoundedSemaphore(settings.LINK_PROCESSING_AT_ONCE)

def read_places_in_turn(db: Session, link: SavedLink) -> ExtractionResult:
    with _reading:
        return read_places(db, link)

def process_link(link_id: int):
    """
    Fetch a link's details and extract the places from its video.

    Runs in the background after the response has been sent, so it opens its own database session.
    """
    db = SessionLocal()

    try:
        link = db.query(SavedLink).filter(SavedLink.id == link_id).first()
        if link is None:
            return

        link.status = "processing"
        link.error = None
        db.commit()

        metadata = fetch_metadata(link.url, link.platform)
        if metadata is not None:
            for field, value in metadata.items():
                setattr(link, field, value)

        reads_places = settings.GEMINI_API_KEY and link.platform in (*VIDEO_PLATFORMS, SCREENSHOT, ARTICLE)
        if reads_places:
            try:
                result = read_places_in_turn(db, link)
            except (ExtractionError, ArticleError) as e:
                link.status = "failed"
                link.error = str(e)[:500]
            else:
                link.caption = result.caption
                link.summary = result.summary
                # TikTok's embed info is often missing for photo posts, so fall back to the post's own
                link.author_name = link.author_name or (result.author_name or "")[:255] or None
                link.thumbnail_url = link.thumbnail_url or (result.thumbnail_url or "")[:2048] or None
                # Replace places from an earlier run, except ones the user has corrected or planned
                planned_ids = {
                    place_id for (place_id,) in db.query(Activity.place_id).filter(
                        Activity.place_id.in_([place.id for place in link.places])
                    )
                }
                kept = [place for place in link.places if place.user_edited or place.id in planned_ids]
                kept_names = {place.name.casefold() for place in kept}
                link.places = kept + [
                    ExtractedPlace(**fit_to_columns(place.model_dump()))
                    for place in result.places
                    if place.name.casefold() not in kept_names
                ]
                if link.place_name is None and result.places:
                    link.place_name = result.places[0].name[:255]
                link.status = "processed"
        elif link.platform in VIDEO_PLATFORMS and metadata is None:
            link.status = "failed"
            link.error = "Could not fetch the post's details"
        else:
            link.status = "processed"

        link.processed_at = datetime.now(timezone.utc)
        db.commit()

        # Show the places straight away, then fill in addresses and opening hours one by one
        trip = db.query(Trip).filter(Trip.id == link.trip_id).first()
        destination = trip.main_destination if trip else None
        for place in link.places:
            # Places kept from an earlier run already have their details
            if place.details_status != "pending":
                continue
            try:
                enrich_place(db, place, fallback_city=destination)
            except Exception:
                logger.exception("Failed to look up place %s", place.id)
                place.details_status = "failed"
            db.commit()
    except Exception:
        # Never leave a link stuck in "processing"
        logger.exception("Failed to process link %s", link_id)
        db.rollback()
        link = db.query(SavedLink).filter(SavedLink.id == link_id).first()
        if link is not None:
            link.status = "failed"
            link.error = "Unexpected error while processing the link"
            link.processed_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()

def limit_link_processing(db: Session, membership: TripMembership):
    """Each save or re-check downloads a video and asks the AI about it, which costs money."""
    day = timedelta(days=1)
    person, everyone = f"link-saves:{membership.user_id}", "link-saves:all"
    # Check both before counting either, so a refused save doesn't use up anyone's allowance
    rate_limit.check(db, person, settings.LINK_SAVES_DAILY_LIMIT, day,
                     "You've saved a lot of posts today. Try again tomorrow.")
    rate_limit.check(db, everyone, settings.LINK_SAVES_DAILY_LIMIT_ALL, day,
                     "Triplet has read as many posts as it can today. Try again tomorrow.")
    rate_limit.record(db, person, day)
    rate_limit.record(db, everyone, day)

@router.post("", response_model=SavedLinkResponse, status_code=201)
def create_link(
    trip_id: int,
    link_create: SavedLinkCreate,
    response: Response,
    background_tasks: BackgroundTasks,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)
    url = str(link_create.url)

    # Saving a post that's already in the trip (a double tap, or pasting it again) gives back the
    # one there, without downloading it again or counting against the daily limit
    key = post_key(url)
    for existing in db.query(SavedLink).filter(SavedLink.trip_id == trip_id, SavedLink.platform != SCREENSHOT):
        if post_key(existing.url) == key:
            response.status_code = status.HTTP_200_OK
            return existing

    limit_link_processing(db, membership)

    link = SavedLink(
        trip_id=trip_id,
        added_by_id=membership.user_id,
        url=url,
        platform=detect_platform(url),
        place_name=link_create.place_name,
        notes=link_create.notes,
        status="pending"
    )

    db.add(link)
    db.commit()
    db.refresh(link)

    # Downloading and analysing the video can take a while, so the client polls for the result
    background_tasks.add_task(process_link, link.id)

    return link

# Under the API's 1 MB request limit; the app shrinks screenshots well below this
SCREENSHOT_MAX_BYTES = 900 * 1024

def image_signature(link_id: int) -> str:
    """Screenshots are private to a trip; this signs their address so only people given it can open it."""
    return hmac.new(settings.SECRET_KEY.encode(), f"link-image:{link_id}".encode(), hashlib.sha256).hexdigest()[:32]

def image_path(link_id: int) -> str:
    return f"/link-images/{link_id}?sig={image_signature(link_id)}"

@router.post("/screenshot", response_model=SavedLinkResponse, status_code=201)
async def create_screenshot(
    trip_id: int,
    file: UploadFile,
    background_tasks: BackgroundTasks,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """Save a screenshot, like a post or a map someone sent, and read the places in it."""
    require_role(membership, EDITOR_ROLES)

    data = await file.read(SCREENSHOT_MAX_BYTES + 1)
    if len(data) > SCREENSHOT_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="That screenshot is too big. Try a smaller one."
        )
    content_type = avatar_content_type(data)
    if content_type is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Use a JPEG, PNG or WebP image"
        )
    limit_link_processing(db, membership)

    link = SavedLink(
        trip_id=trip_id,
        added_by_id=membership.user_id,
        # Filled in below, once the link has its id
        url="",
        platform=SCREENSHOT,
        title="Screenshot",
        status="pending"
    )
    db.add(link)
    db.flush()
    link.url = image_path(link.id)
    link.thumbnail_url = link.url
    db.add(LinkImage(link_id=link.id, content_type=content_type, data=data))
    db.commit()
    db.refresh(link)

    background_tasks.add_task(process_link, link.id)

    return link

# Screenshots are served outside the trip's routes so image views can load them without a token
image_router = APIRouter(
    prefix="/link-images",
    tags=["Saved Links"]
)

@image_router.get("/{link_id}")
def get_link_image(
    link_id: int,
    sig: str,
    db: Session = Depends(connect_db)
):
    image = db.get(LinkImage, link_id)
    if image is None or not hmac.compare_digest(sig, image_signature(link_id)):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found"
        )

    return Response(
        content=image.data,
        media_type=image.content_type,
        headers={"Cache-Control": "private, max-age=31536000, immutable"}
    )

@router.get("", response_model=list[SavedLinkResponse])
def get_links(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership),
    pagination: Pagination = Depends()
):
    links = (
        db.query(SavedLink)
        .options(selectinload(SavedLink.places))
        .filter(SavedLink.trip_id == trip_id)
        .order_by(SavedLink.created_at.desc(), SavedLink.id.desc())
        .limit(pagination.limit)
        .offset(pagination.offset)
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

@router.post("/{link_id}/refresh", response_model=SavedLinkResponse, status_code=status.HTTP_202_ACCEPTED)
def refresh_link(
    trip_id: int,
    link_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    link = get_link_or_404(db, trip_id, link_id)
    # Already being read: pressing again changes nothing and isn't counted
    if link.status in ("pending", "processing"):
        return link
    limit_link_processing(db, membership)

    link.status = "pending"
    link.error = None
    db.commit()
    db.refresh(link)

    background_tasks.add_task(process_link, link.id)

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

    place = None
    if link_to_activity.place_id is not None:
        place = db.query(ExtractedPlace).filter(
            ExtractedPlace.id == link_to_activity.place_id,
            ExtractedPlace.link_id == link.id
        ).first()

        if place is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Place not found"
            )

    activity = new_activity_from_link(db, trip_id, link, place, link_to_activity)

    db.add(activity)
    db.commit()
    db.refresh(activity)

    return activity

def new_activity_from_link(
    db: Session,
    trip_id: int,
    link: SavedLink,
    place: ExtractedPlace | None,
    link_to_activity: LinkToActivity
) -> Activity:
    """A plan for a saved post (or one place in it), filled in from the place. Not added to the session."""
    place_location = None
    if place is not None:
        # Google's addresses already end with the city and OpenStreetMap's start with the name,
        # so don't repeat either
        address = place.address or ""
        name = None if address.casefold().startswith(place.name.casefold()) else place.name
        city = place.city if place.city and place.city not in address else None
        place_location = ", ".join(part for part in [name, place.address, city] if part)

    title = link_to_activity.title or (place.name if place else None) or link.place_name or link.title
    location = link_to_activity.location or place_location or link.place_name

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
    return Activity(
        trip_id=trip_id,
        source_link_id=link.id,
        place_id=place.id if place else None,
        title=title[:255],
        description=link_to_activity.description or (place.notes if place else None) or link.notes,
        location=location[:255],
        latitude=place.latitude if place else None,
        longitude=place.longitude if place else None,
        start_time=link_to_activity.start_time,
        end_time=link_to_activity.end_time,
        estimated_cost=link_to_activity.estimated_cost
    )
