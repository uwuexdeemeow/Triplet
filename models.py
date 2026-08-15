from sqlalchemy import Date, String, Integer, DateTime, func, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from datetime import date, datetime
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

    start_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=False
    )

    end_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=False
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

    class Activity(Base):
        __tablename__ = "activities"

        id: Mapped[int] = mapped_column(
            primary_key=True
        )

        trip_id: Mapped[int] = mapped_column(
            ForeignKey("trips.id", ondelete="CASCADE"),
            nullable=False
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

        start_time: Mapped[datetime | None] = mapped_column(
            DateTime(timezone=True),
            nullable=False
        )

        end_time: Mapped[datetime | None] = mapped_column(
            DateTime(timezone=True),
            nullable=False
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
        nullable=False
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