from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from models import User, TripMembership, TripInvitation
from schemas import InvitationResponse
from dependencies import get_current_user, Pagination

router = APIRouter(
    prefix="/invitations",
    tags=["Invitations"]
)

def get_pending_invitation(db: Session, invitation_id: int, user_id: int) -> TripInvitation:
    invitation = db.query(TripInvitation).filter(
        TripInvitation.id == invitation_id,
        TripInvitation.user_id == user_id
    ).first()

    if invitation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation not found"
        )

    if invitation.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invitation has already been answered"
        )

    return invitation

@router.get("", response_model=list[InvitationResponse])
def get_my_invitations(
    db: Session = Depends(connect_db),
    current_user: User = Depends(get_current_user),
    pagination: Pagination = Depends()
):
    invitations = (
        db.query(TripInvitation)
        .filter(
            TripInvitation.user_id == current_user.id,
            TripInvitation.status == "pending"
        )
        .order_by(TripInvitation.created_at.desc(), TripInvitation.id.desc())
        .limit(pagination.limit)
        .offset(pagination.offset)
        .all()
    )

    return invitations

@router.post("/{invitation_id}/accept", response_model=InvitationResponse)
def accept_invitation(
    invitation_id: int,
    db: Session = Depends(connect_db),
    current_user: User = Depends(get_current_user)
):
    invitation = get_pending_invitation(db, invitation_id, current_user.id)

    already_member = db.query(TripMembership).filter(
        TripMembership.trip_id == invitation.trip_id,
        TripMembership.user_id == current_user.id
    ).first()

    if already_member is None:
        db.add(TripMembership(
            user_id=current_user.id,
            trip_id=invitation.trip_id,
            role="member"
        ))

    invitation.status = "accepted"
    db.commit()
    db.refresh(invitation)

    return invitation

@router.post("/{invitation_id}/decline", response_model=InvitationResponse)
def decline_invitation(
    invitation_id: int,
    db: Session = Depends(connect_db),
    current_user: User = Depends(get_current_user)
):
    invitation = get_pending_invitation(db, invitation_id, current_user.id)

    invitation.status = "declined"
    db.commit()
    db.refresh(invitation)

    return invitation
