from sqlalchemy import Boolean, Date, Float, JSON, String, Integer, DateTime, false, func, Text, ForeignKey, UniqueConstraint, Numeric, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import date, datetime
from decimal import Decimal
from database import Base

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(
        primary_key=True,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False
    )

    password: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )

    avatar_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True
    )


    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(
        primary_key=True,
    )

    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True
    )

    destination: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )

    start_date: Mapped[date] = mapped_column(
        Date,
        nullable=False
    )

    end_date: Mapped[date] = mapped_column(
        Date,
        nullable=False
    )

    budget: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True
    )

    currency: Mapped[str] = mapped_column(
        String(3),
        nullable=False,
        default="USD",
        server_default="USD"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now()
    )

class TripMembership(Base):
    __tablename__ = "trip_memberships"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False
    )

    trip_id: Mapped[int] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"),
        nullable=False
    )

    role: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="member"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "trip_id", name="uq_user_trip"),
    )

class SavedLink(Base):
    __tablename__ = "saved_links"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    trip_id: Mapped[int] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"),
        nullable=False
    )

    added_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )

    url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False
    )

    platform: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="other"
    )

    title: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True
    )

    # The name the user gave the post; shown instead of the post's own title, and kept when
    # the post is looked up again
    custom_title: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    author_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    thumbnail_url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True
    )

    place_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True
    )

    # Full caption from the post, which is often longer than the oEmbed title
    caption: Mapped[str | None] = mapped_column(
        Text,
        nullable=True
    )

    summary: Mapped[str | None] = mapped_column(
        Text,
        nullable=True
    )

    # pending -> processing -> processed / failed
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending"
    )

    error: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True
    )

    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    places: Mapped[list["ExtractedPlace"]] = relationship(
        order_by="ExtractedPlace.id",
        cascade="all, delete-orphan",
        passive_deletes=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

class ExtractedPlace(Base):
    __tablename__ = "extracted_places"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    link_id: Mapped[int] = mapped_column(
        ForeignKey("saved_links.id", ondelete="CASCADE"),
        nullable=False
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )

    category: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True
    )

    address: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True
    )

    city: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    country: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    price_range: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True
    )

    notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True
    )

    # Opening hours as the post describes them, e.g. "11am - 9pm, closed Mondays"
    hours_from_post: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    latitude: Mapped[float | None] = mapped_column(
        Float,
        nullable=True
    )

    longitude: Mapped[float | None] = mapped_column(
        Float,
        nullable=True
    )

    # Seven entries, Monday first, e.g. "11:00 AM – 3:00 PM" or "Closed"
    opening_hours: Mapped[list[str] | None] = mapped_column(
        JSON,
        nullable=True
    )

    website: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True
    )

    phone: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True
    )

    google_place_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    # pending, found, not_found, limit_reached, failed or skipped (no API key)
    details_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending",
        server_default="pending"
    )

    # The lookup matched more than one place, so the user should check the address
    needs_review: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=false()
    )

    # Set once the user edits the place, so lookups never overwrite their changes
    user_edited: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=false()
    )

    details_fetched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    # "osm" or "google": which service the looked-up details came from, so the app can credit it
    details_source: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

class RateLimit(Base):
    """Recent attempts per key (e.g. "login-email:sam@example.com"), to slow down guessing and abuse."""
    __tablename__ = "rate_limits"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    key: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True
    )

    window_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )

    count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )

class ApiUsage(Base):
    """Daily call counts for paid APIs, used to stay inside the free allowance."""
    __tablename__ = "api_usage"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    api: Mapped[str] = mapped_column(
        String(50),
        nullable=False
    )

    day: Mapped[date] = mapped_column(
        Date,
        nullable=False
    )

    count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )

    __table_args__ = (
        UniqueConstraint("api", "day", name="uq_api_usage_api_day"),
    )

class Activity(Base):
    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    trip_id: Mapped[int] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"),
        nullable=False
    )

    source_link_id: Mapped[int | None] = mapped_column(
        ForeignKey("saved_links.id", ondelete="SET NULL"),
        nullable=True
    )

    # The extracted place this activity was planned from, so the map knows it's planned
    place_id: Mapped[int | None] = mapped_column(
        ForeignKey("extracted_places.id", ondelete="SET NULL"),
        nullable=True
    )

    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True
    )

    location: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )

    latitude: Mapped[float | None] = mapped_column(
        Float,
        nullable=True
    )

    longitude: Mapped[float | None] = mapped_column(
        Float,
        nullable=True
    )

    start_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )

    end_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )

    estimated_cost: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 2),
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now()
    )

class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    trip_id: Mapped[int] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"),
        nullable=False
    )

    paid_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )

    activity_id: Mapped[int | None] = mapped_column(
        ForeignKey("activities.id", ondelete="SET NULL"),
        nullable=True
    )

    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )

    amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False
    )

    category: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="other"
    )

    spent_on: Mapped[date | None] = mapped_column(
        Date,
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

class TripGuestAccess(Base):
    __tablename__ = "trip_guest_access"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    trip_id: Mapped[int] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"),
        nullable=False,
        unique=True
    )

    access_code: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        unique=True
    )

    pin_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

class TripInvitation(Base):
    __tablename__ = "trip_invitations"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False
    )

    trip_id: Mapped[int] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"),
        nullable=False
    )

    invited_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("user_id", "trip_id", name="uq_invitation_user_trip"),
    )

    # The invitee isn't a member yet, so the invitation carries what they need to decide
    trip: Mapped["Trip"] = relationship(foreign_keys=[trip_id])
    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    invited_by: Mapped["User | None"] = relationship(foreign_keys=[invited_by_id])

    @property
    def trip_title(self) -> str:
        return self.trip.title

    @property
    def trip_destination(self) -> str:
        return self.trip.destination

    @property
    def trip_start_date(self) -> date | None:
        return self.trip.start_date

    @property
    def trip_end_date(self) -> date | None:
        return self.trip.end_date

    @property
    def invitee_name(self) -> str:
        return self.user.name

    @property
    def invitee_email(self) -> str:
        return self.user.email

    @property
    def invited_by_name(self) -> str | None:
        return self.invited_by.name if self.invited_by else None

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False
    )

    # Only a hash is stored so a database leak doesn't leak usable tokens
    token_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )

    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False
    )

    token_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )

    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

# Profile photos live in their own table so loading a user doesn't load the image
class UserAvatar(Base):
    __tablename__ = "user_avatars"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True
    )

    content_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False
    )

    data: Mapped[bytes] = mapped_column(
        LargeBinary,
        nullable=False
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )
