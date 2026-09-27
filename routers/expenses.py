from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import budget_estimate
import exchange_rates
import scheduling
from database import connect_db
from models import User, Trip, TripMembership, Activity, Expense, ExtractedPlace
from routers.activities import build_itinerary
from schemas import ExpenseCreate, ExpenseUpdate, ExpenseResponse, BudgetSummary, MemberBalance, BudgetEstimate, BudgetEstimateDay
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

@router.get("/budget/estimate", response_model=BudgetEstimate)
def get_budget_estimate(
    trip_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    currency = trip.currency
    people = max(1, db.query(TripMembership).filter(TripMembership.trip_id == trip_id).count())
    rates = exchange_rates.usd_rates()
    notes = ["Rough figures for the whole group, from typical prices. Hotels and flights aren’t included."]

    def from_usd(amount: float) -> float | None:
        return exchange_rates.convert(amount, "USD", currency, rates)

    typical_prices = from_usd(1) is not None
    if not typical_prices:
        notes.append(f"Typical prices aren’t available in {currency} right now, so only costs you’ve entered are counted.")

    activities = (
        db.query(Activity)
        .filter(Activity.trip_id == trip_id)
        .order_by(Activity.start_time, Activity.id)
        .all()
    )
    itinerary = build_itinerary(db, trip_id, activities, include_weather=False)
    place_ids = {a.place_id for a in activities if a.place_id is not None}
    places = {p.id: p for p in db.query(ExtractedPlace).filter(ExtractedPlace.id.in_(place_ids)).all()} if place_ids else {}

    paid = defaultdict(Decimal)
    for expense in db.query(Expense).filter(Expense.trip_id == trip_id, Expense.activity_id.isnot(None)).all():
        paid[expense.activity_id] += expense.amount

    def plan_cost(activity) -> float | None:
        # What was paid beats what was typed, which beats our guess
        if activity.id in paid:
            return float(paid[activity.id])
        if activity.estimated_cost is not None:
            return float(activity.estimated_cost)
        place = places.get(activity.place_id)
        if place is None:
            return None
        price = budget_estimate.parse_price(place.price_range, currency)
        if price is not None and price[0] == "amount":
            converted = exchange_rates.convert(price[1], price[2], currency, rates)
            if converted is not None:
                return converted * people
        typical = budget_estimate.CATEGORY_USD.get(place.category or "other")
        if typical is None or not typical_prices:
            return None
        level = price[1] if price is not None and price[0] == "level" else 1.0
        return from_usd(typical * level) * people

    planned_by_day = {day.date: day.activities for day in itinerary.days}
    days = []
    unpriced = 0
    trip_days = (trip.end_date - trip.start_date).days + 1 if trip.start_date and trip.end_date else 0
    for offset in range(trip_days):
        day = trip.start_date + timedelta(days=offset)
        day_activities = planned_by_day.get(day, [])

        plans = 0.0
        for activity in day_activities:
            cost = plan_cost(activity)
            if cost is None:
                unpriced += 1
            else:
                plans += cost

        meals = transport = 0.0
        if typical_prices:
            covered = budget_estimate.meals_covered([
                (places[a.place_id].category if a.place_id in places else None, scheduling.minutes_of(a.start_time))
                for a in day_activities
            ])
            meals = sum(
                from_usd(usd) * people for meal, usd in budget_estimate.MEAL_USD.items() if meal not in covered
            )
            rides = sum(
                1 for a in day_activities if a.travel_from_previous and a.travel_from_previous.mode == "transit"
            )
            transport = from_usd(budget_estimate.TRANSIT_RIDE_USD) * people * rides

        days.append(BudgetEstimateDay(
            date=day,
            plans=round(plans, 2),
            meals=round(meals, 2),
            transport=round(transport, 2),
            total=round(plans + meals + transport, 2)
        ))

    if unpriced:
        notes.append(
            f"{unpriced} {'plan has' if unpriced == 1 else 'plans have'} no cost yet. Add one to make the estimate closer."
        )

    total = sum(day.total for day in days)
    budget = float(trip.budget) if trip.budget is not None else None
    return BudgetEstimate(
        currency=currency,
        people=people,
        days=days,
        plans_total=round(sum(day.plans for day in days), 2),
        meals_total=round(sum(day.meals for day in days), 2),
        transport_total=round(sum(day.transport for day in days), 2),
        total=round(total, 2),
        budget=budget,
        over_budget_by=round(total - budget, 2) if budget is not None else None,
        unpriced_plans=unpriced,
        notes=notes
    )
