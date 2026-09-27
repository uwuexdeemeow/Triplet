from datetime import timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from config import settings
from mailer import send_email
from models import Trip, User, TripMembership, TripInvitation
from schemas import MemberResponse, MemberRoleUpdate, InvitationCreate, InvitationResponse
from dependencies import get_trip_membership, require_role, Pagination
import rate_limit

router = APIRouter(
    prefix="/trips/{trip_id}",
    tags=["Trip Members"]
)

INVITE_LIMIT = 30
INVITE_WINDOW = timedelta(hours=1)

def count_owners(db: Session, trip_id: int) -> int:
    return db.query(TripMembership).filter(
        TripMembership.trip_id == trip_id,
        TripMembership.role == "owner"
    ).count()

def get_target_membership(db: Session, trip_id: int, user_id: int) -> TripMembership:
    target = db.query(TripMembership).filter(
        TripMembership.trip_id == trip_id,
        TripMembership.user_id == user_id
    ).first()

    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found"
        )

    return target

@router.get("/members", response_model=list[MemberResponse])
def get_members(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership),
    pagination: Pagination = Depends()
):
    rows = (
        db.query(TripMembership, User)
        .join(User, User.id == TripMembership.user_id)
        .filter(TripMembership.trip_id == trip_id)
        .order_by(TripMembership.id)
        .limit(pagination.limit)
        .offset(pagination.offset)
        .all()
    )

    return [
        MemberResponse(user_id=user.id, name=user.name, email=user.email, role=member.role)
        for member, user in rows
    ]

@router.patch("/members/{user_id}", response_model=MemberResponse)
def update_member_role(
    trip_id: int,
    user_id: int,
    role_update: MemberRoleUpdate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, ["owner"])

    target = get_target_membership(db, trip_id, user_id)

    # A trip must always keep at least one owner
    if target.role == "owner" and role_update.role != "owner" and count_owners(db, trip_id) <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A trip must have at least one owner"
        )

    target.role = role_update.role
    db.commit()

    user = db.query(User).filter(User.id == user_id).first()
    return MemberResponse(user_id=user.id, name=user.name, email=user.email, role=target.role)

@router.delete("/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    trip_id: int,
    user_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    # Anyone can leave a trip, only owners can remove other people
    if user_id != membership.user_id:
        require_role(membership, ["owner"])

    target = get_target_membership(db, trip_id, user_id)

    if target.role == "owner" and count_owners(db, trip_id) <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A trip must have at least one owner"
        )

    db.delete(target)
    db.commit()

@router.post("/invitations", response_model=InvitationResponse, status_code=201)
def create_invitation(
    trip_id: int,
    invitation_create: InvitationCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, ["owner"])

    rate_limit.hit(db, f"invite-user:{membership.user_id}", INVITE_LIMIT, INVITE_WINDOW,
                   "You've sent a lot of invites. Try again in a while.")

    inviter = db.query(User).filter(User.id == membership.user_id).first()
    trip = db.query(Trip).filter(Trip.id == trip_id).first()

    if invitation_create.email is not None:
        email = invitation_create.email
        if email == inviter.email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot invite yourself"
            )
        # Only confirmed accounts count; anyone else gets an invite to sign up. The answer looks
        # the same either way, so inviting can't be used to find out who's on Triplet.
        invitee = db.query(User).filter(User.email == email, User.email_verified_at.isnot(None)).first()
    else:
        # By id only for people you already share a trip with (picked from search)
        my_trips = db.query(TripMembership.trip_id).filter(TripMembership.user_id == membership.user_id)
        invitee = (
            db.query(User)
            .join(TripMembership, TripMembership.user_id == User.id)
            .filter(User.id == invitation_create.user_id, TripMembership.trip_id.in_(my_trips))
            .first()
        )
        if invitee is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        email = invitee.email

    if invitee is not None:
        if invitee.id == membership.user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot invite yourself"
            )

        # The owner can already see who's on the trip, so saying so reveals nothing new
        already_member = db.query(TripMembership).filter(
            TripMembership.trip_id == trip_id,
            TripMembership.user_id == invitee.id
        ).first()
        if already_member:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User is already a member of this trip"
            )

        invitation = db.query(TripInvitation).filter(
            TripInvitation.trip_id == trip_id,
            TripInvitation.user_id == invitee.id
        ).first()
    else:
        invitation = db.query(TripInvitation).filter(
            TripInvitation.trip_id == trip_id,
            TripInvitation.email == email,
            TripInvitation.user_id.is_(None)
        ).first()

    if invitation is not None and invitation.status == "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User has already been invited"
        )

    # Re-use an old declined/accepted row because of the unique (user_id, trip_id) constraint
    if invitation is None:
        invitation = TripInvitation(trip_id=trip_id)
        db.add(invitation)

    invitation.user_id = invitee.id if invitee is not None else None
    invitation.email = email
    invitation.invited_by_id = membership.user_id
    invitation.status = "pending"

    db.commit()
    db.refresh(invitation)

    # Everyone invited gets an email: people on Triplet as a heads-up, others to join
    if invitee is not None:
        next_step = f"Open Triplet to join: {settings.APP_URL}/invites"
    else:
        next_step = (
            f"Sign up with this email to join: {settings.APP_URL}/signup\n"
            "The trip will be waiting in your Invites once you've confirmed your email."
        )
    background_tasks.add_task(
        send_email,
        email,
        f"{inviter.name} invited you to {trip.title} on Triplet",
        f"Hi,\n\n{inviter.name} invited you to plan {trip.title} ({trip.destination}) together on Triplet.\n\n{next_step}"
    )

    return invitation

@router.get("/invitations", response_model=list[InvitationResponse])
def get_trip_invitations(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership),
    pagination: Pagination = Depends()
):
    invitations = (
        db.query(TripInvitation)
        .filter(TripInvitation.trip_id == trip_id)
        .order_by(TripInvitation.created_at.desc(), TripInvitation.id.desc())
        .limit(pagination.limit)
        .offset(pagination.offset)
        .all()
    )

    return invitations

@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_invitation(
    trip_id: int,
    invitation_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, ["owner"])

    invitation = db.query(TripInvitation).filter(
        TripInvitation.id == invitation_id,
        TripInvitation.trip_id == trip_id
    ).first()

    if invitation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation not found"
        )

    db.delete(invitation)
    db.commit()
