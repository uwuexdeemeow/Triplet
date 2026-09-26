from collections import defaultdict
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from models import User, Trip, TripMembership, Activity, Expense
from schemas import ExpenseCreate, ExpenseUpdate, ExpenseResponse, BudgetSummary, MemberBalance
from dependencies import get_trip_membership, require_role, EDITOR_ROLES, Pagination

router = APIRouter(
    prefix="/trips/{trip_id}",
    tags=["Budget"]
)

def validate_expense_links(db: Session, trip_id: int, paid_by_id: int | None, activity_id: int | None):
    if paid_by_id is not None:
        payer = db.query(TripMembership).filter(
            TripMembership.trip_id == trip_id,
            TripMembership.user_id == paid_by_id
        ).first()

        if payer is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payer must be a member of the trip"
            )

    if activity_id is not None:
        activity = db.query(Activity).filter(
            Activity.id == activity_id,
            Activity.trip_id == trip_id
        ).first()

        if activity is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Activity not found"
            )

def get_expense_or_404(db: Session, trip_id: int, expense_id: int) -> Expense:
    expense = db.query(Expense).filter(
        Expense.id == expense_id,
        Expense.trip_id == trip_id
    ).first()

    if expense is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found"
        )

    return expense

@router.post("/expenses", response_model=ExpenseResponse, status_code=201)
def create_expense(
    trip_id: int,
    expense_create: ExpenseCreate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    # Default to whoever logged the expense
    paid_by_id = expense_create.paid_by_id or membership.user_id

    validate_expense_links(db, trip_id, paid_by_id, expense_create.activity_id)

    expense = Expense(
        trip_id=trip_id,
        paid_by_id=paid_by_id,
        activity_id=expense_create.activity_id,
        title=expense_create.title,
        amount=expense_create.amount,
        category=expense_create.category,
        spent_on=expense_create.spent_on
    )

    db.add(expense)
    db.commit()
    db.refresh(expense)

    return expense

@router.get("/expenses", response_model=list[ExpenseResponse])
def get_expenses(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership),
    pagination: Pagination = Depends()
):
    expenses = (
        db.query(Expense)
        .filter(Expense.trip_id == trip_id)
        .order_by(Expense.spent_on, Expense.created_at, Expense.id)
        .limit(pagination.limit)
        .offset(pagination.offset)
        .all()
    )

    return expenses

@router.get("/expenses/{expense_id}", response_model=ExpenseResponse)
def get_expense(
    trip_id: int,
    expense_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    return get_expense_or_404(db, trip_id, expense_id)

@router.patch("/expenses/{expense_id}", response_model=ExpenseResponse)
def update_expense(
    trip_id: int,
    expense_id: int,
    expense_update: ExpenseUpdate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    expense = get_expense_or_404(db, trip_id, expense_id)

    update_data = expense_update.model_dump(
        exclude_unset=True
    )

    # These columns are NOT NULL, so an explicit null means "leave unchanged"
    required_fields = ["title", "amount", "category"]
    update_data = {
        field: value for field, value in update_data.items()
        if not (value is None and field in required_fields)
    }

    validate_expense_links(
        db,
        trip_id,
        update_data.get("paid_by_id"),
        update_data.get("activity_id")
    )

    for field, value in update_data.items():
        setattr(expense, field, value)

    db.commit()
    db.refresh(expense)

    return expense

@router.delete("/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(
    trip_id: int,
    expense_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    require_role(membership, EDITOR_ROLES)

    expense = get_expense_or_404(db, trip_id, expense_id)

    db.delete(expense)
    db.commit()

@router.get("/budget", response_model=BudgetSummary)
def get_budget(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()

    expenses = db.query(Expense).filter(Expense.trip_id == trip_id).all()

    planned_activity_cost = sum(
        (activity.estimated_cost or Decimal("0")
         for activity in db.query(Activity).filter(Activity.trip_id == trip_id).all()),
        Decimal("0")
    )

    total_spent = Decimal("0")
    by_category = defaultdict(Decimal)
    paid_by = defaultdict(Decimal)

    for expense in expenses:
        total_spent += expense.amount
        by_category[expense.category] += expense.amount
        if expense.paid_by_id is not None:
            paid_by[expense.paid_by_id] += expense.amount

    members = (
        db.query(TripMembership, User)
        .join(User, User.id == TripMembership.user_id)
        .filter(TripMembership.trip_id == trip_id)
        .order_by(TripMembership.id)
        .all()
    )

    # Expenses are split evenly between everyone on the trip.
    # A positive balance means the member is owed money, negative means they owe.
    share = total_spent / len(members) if members else Decimal("0")

    balances = [
        MemberBalance(
            user_id=user.id,
            name=user.name,
            paid=round(float(paid_by[user.id]), 2),
            share=round(float(share), 2),
            balance=round(float(paid_by[user.id] - share), 2)
        )
        for member, user in members
    ]

    return BudgetSummary(
        trip_id=trip_id,
        currency=trip.currency,
        budget=float(trip.budget) if trip.budget is not None else None,
        total_spent=float(total_spent),
        remaining=float(trip.budget - total_spent) if trip.budget is not None else None,
        planned_activity_cost=float(planned_activity_cost),
        by_category={category: float(amount) for category, amount in by_category.items()},
        balances=balances
    )
