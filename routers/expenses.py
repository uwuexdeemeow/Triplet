from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import budget_estimate
import price_levels
import exchange_rates
import scheduling
import splits
from database import connect_db
from models import User, Trip, TripMembership, Activity, Expense, ExpenseShare, ExtractedPlace, Settlement, Flight
from routers.activities import build_itinerary, stays_by_night
from schemas import (
    ExpenseCreate, ExpenseUpdate, ExpenseResponse, ExpenseShareIn, BudgetSummary, MemberBalance, BudgetEstimate,
    BudgetEstimateDay, SettlementCreate, SettlementResponse, Transfer
)
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

def member_ids(db: Session, trip_id: int) -> set[int]:
    return {user_id for (user_id,) in db.query(TripMembership.user_id).filter(TripMembership.trip_id == trip_id)}

def apply_split(db: Session, trip_id: int, expense: Expense, split: str, shares: list[ExpenseShareIn]):
    """
    Set who shares an expense. "all" needs no shares: it's everyone on the trip, worked out when
    shown. "people" splits evenly between those listed; "amounts" takes the amounts given, which
    must add up to the expense.
    """
    if split == "all":
        expense.split = "all"
        expense.shares = []
        return

    user_ids = [share.user_id for share in shares]
    if not user_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose who shares this expense")
    if len(set(user_ids)) != len(user_ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Each person can only be listed once")
    if not set(user_ids) <= member_ids(db, trip_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Everyone sharing it must be on the trip")

    if split == "people":
        amounts = splits.even_shares(expense.amount, user_ids)
    else:
        if any(share.amount is None for share in shares):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter an amount for each person")
        amounts = {share.user_id: splits.cents(share.amount) for share in shares}
        total = sum(amounts.values(), splits.cents(0))
        if total != splits.cents(expense.amount):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"The amounts add up to {total}, not {splits.cents(expense.amount)}"
            )

    expense.split = split
    # Replacing the list deletes the old shares (delete-orphan)
    expense.shares = [ExpenseShare(user_id=user_id, amount=amount) for user_id, amount in amounts.items() if amount > 0 or split == "people"]

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
    apply_split(db, trip_id, expense, expense_create.split, expense_create.shares)

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

    split = update_data.pop("split", None)
    update_data.pop("shares", None)
    for field, value in update_data.items():
        setattr(expense, field, value)

    if split is not None or expense_update.shares is not None:
        apply_split(db, trip_id, expense, split or expense.split, expense_update.shares or [])
    elif "amount" in update_data and expense.split == "people":
        # Same people, new total: work their parts out again
        apply_split(db, trip_id, expense, "people", [ExpenseShareIn(user_id=share.user_id) for share in expense.shares])
    elif "amount" in update_data and expense.split == "amounts":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This expense is split by amounts, so change each person's amount too"
        )

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

    # Each person's part: expenses split between everyone are shared evenly by whoever is on the
    # trip now; the others by their own shares. A positive balance means the member is owed
    # money, negative means they owe.
    share = defaultdict(Decimal)
    everyone = [user.id for member, user in members]
    for expense in expenses:
        if expense.split == "all":
            if everyone:
                for user_id, amount in splits.even_shares(expense.amount, everyone).items():
                    share[user_id] += amount
        else:
            for part in expense.shares:
                share[part.user_id] += part.amount

    # Paying someone back evens things out without being spending
    settlements = db.query(Settlement).filter(Settlement.trip_id == trip_id).order_by(Settlement.created_at, Settlement.id).all()
    settled = defaultdict(Decimal)
    for settlement in settlements:
        if settlement.from_user_id is not None:
            settled[settlement.from_user_id] += settlement.amount
        if settlement.to_user_id is not None:
            settled[settlement.to_user_id] -= settlement.amount

    names = {user.id: user.name for member, user in members}
    net = {user_id: paid_by[user_id] - share[user_id] + settled[user_id] for user_id in everyone}
    balances = [
        MemberBalance(
            user_id=user_id,
            name=names[user_id],
            paid=round(float(paid_by[user_id]), 2),
            share=round(float(share[user_id]), 2),
            balance=round(float(net[user_id]), 2)
        )
        for user_id in everyone
    ]
    settle_up = [
        Transfer(from_user_id=debtor, from_name=names[debtor], to_user_id=creditor, to_name=names[creditor], amount=float(amount))
        for debtor, creditor, amount in splits.settle_up(net)
    ]

    return BudgetSummary(
        trip_id=trip_id,
        currency=trip.currency,
        budget=float(trip.budget) if trip.budget is not None else None,
        total_spent=float(total_spent),
        remaining=float(trip.budget - total_spent) if trip.budget is not None else None,
        planned_activity_cost=float(planned_activity_cost),
        by_category={category: float(amount) for category, amount in by_category.items()},
        balances=balances,
        settle_up=settle_up,
        settlements=[SettlementResponse.model_validate(settlement) for settlement in settlements]
    )

@router.post("/settlements", response_model=SettlementResponse, status_code=201)
def create_settlement(
    trip_id: int,
    settlement_create: SettlementCreate,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """Record someone paying someone else back, e.g. from the Budget tab's "Mark as paid"."""
    require_role(membership, EDITOR_ROLES)
    if settlement_create.from_user_id == settlement_create.to_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Someone can't pay themselves back")
    if not {settlement_create.from_user_id, settlement_create.to_user_id} <= member_ids(db, trip_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Both people must be on the trip")

    settlement = Settlement(
        trip_id=trip_id,
        from_user_id=settlement_create.from_user_id,
        to_user_id=settlement_create.to_user_id,
        amount=splits.cents(settlement_create.amount)
    )
    db.add(settlement)
    db.commit()
    db.refresh(settlement)
    return settlement

@router.delete("/settlements/{settlement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_settlement(
    trip_id: int,
    settlement_id: int,
    db: Session = Depends(connect_db),
    membership: TripMembership = Depends(get_trip_membership)
):
    """Undo a payback recorded by mistake."""
    require_role(membership, EDITOR_ROLES)
    settlement = db.query(Settlement).filter(Settlement.id == settlement_id, Settlement.trip_id == trip_id).first()
    if settlement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
    db.delete(settlement)
    db.commit()

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
    notes = ["Rough figures for the whole group, from typical prices."]

    # Typical prices are US ones; scale them to what the trip's first country costs (typed, paid and
    # posted prices are what they are, so they aren't scaled)
    countries = [d.get("country_code") for d in trip.destinations or [] if d.get("country_code")]
    local = price_levels.price_level(countries[0]) if countries else None
    scale = local[0] if local else 1.0

    # Whether any figure below was converted with the rates, which ExchangeRate-API wants a credit for
    used_rates = False

    def from_usd(amount: float) -> float | None:
        return exchange_rates.convert(amount, "USD", currency, rates)

    def typical_in_trip_currency(usd: float) -> float | None:
        nonlocal used_rates
        converted = from_usd(usd * scale)
        # US-dollar typical prices only need the rates for another currency
        if converted is not None and currency != "USD":
            used_rates = True
        return converted

    typical_prices = from_usd(1) is not None
    if not typical_prices:
        notes.append(f"Typical prices aren’t available in {currency} right now, so only costs you’ve entered are counted.")
    elif local:
        note = f"Typical prices adjusted for the cost of living in {local[1]}"
        note += f" (World Bank, {local[2]})." if local[2] else " (World Bank)."
        if len(set(countries)) > 1:
            note += " The trip goes to more than one country, so this uses the first destination’s."
        notes.append(note)

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
        nonlocal used_rates
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
                # A price from a post in another currency was converted, even on a US-dollar trip
                if price[2] != currency:
                    used_rates = True
                return converted * people
        typical = budget_estimate.CATEGORY_USD.get(place.category or "other")
        if typical is None or not typical_prices:
            return None
        level = price[1] if price is not None and price[0] == "level" else 1.0
        return typical_in_trip_currency(typical * level) * people

    planned_by_day = {day.date: day.activities for day in itinerary.days}
    back_to_stay = {day.date: day.travel_to_stay for day in itinerary.days if day.travel_to_stay}
    # Each night costs its share of the stay's price
    nights = stays_by_night(db, trip_id)
    # A flight counts on the day it leaves, or for flights out of somewhere before the trip, the
    # day it lands (or failing both, the first day)
    trip_flights = db.query(Flight).filter(Flight.trip_id == trip_id).all()
    flight_costs = defaultdict(float)
    for flight in trip_flights:
        if flight.cost is None:
            continue
        on = next(
            (when for when in (flight.departs_at.date(), flight.arrives_at.date()) if trip.start_date <= when <= trip.end_date),
            trip.start_date
        )
        flight_costs[on] += float(flight.cost)
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
                typical_in_trip_currency(usd) * people for meal, usd in budget_estimate.MEAL_USD.items() if meal not in covered
            )
            # Including the rides out from the hotel and back to it
            rides = sum(
                1 for a in day_activities if a.travel_from_previous and a.travel_from_previous.mode == "transit"
            ) + (1 if day in back_to_stay and back_to_stay[day].mode == "transit" else 0)
            transport = typical_in_trip_currency(budget_estimate.TRANSIT_RIDE_USD) * people * rides

        stay = nights.get(day)
        stays = float(stay.cost) / (stay.check_out - stay.check_in).days if stay and stay.cost is not None else 0.0

        flights = flight_costs.get(day, 0.0)

        days.append(BudgetEstimateDay(
            date=day,
            plans=round(plans, 2),
            meals=round(meals, 2),
            transport=round(transport, 2),
            stays=round(stays, 2),
            flights=round(flights, 2),
            total=round(plans + meals + transport + stays + flights, 2)
        ))

    if unpriced:
        notes.append(
            f"{unpriced} {'plan has' if unpriced == 1 else 'plans have'} no cost yet. Add one to make the estimate closer."
        )

    stays_listed = {stay.id: stay for stay in nights.values()}
    unpriced_stays = sum(1 for stay in stays_listed.values() if stay.cost is None)
    if not stays_listed:
        notes.append("Hotels aren’t counted yet. Add where you’re staying, with its price, to include them.")
    elif unpriced_stays:
        notes.append(
            f"{unpriced_stays} {'stay has' if unpriced_stays == 1 else 'stays have'} no price yet, so "
            f"{'it isn’t' if unpriced_stays == 1 else 'they aren’t'} counted."
        )

    unpriced_flights = sum(1 for flight in trip_flights if flight.cost is None)
    if not trip_flights:
        notes.append("Flights aren’t counted yet. Add yours, with the price, to include them.")
    elif unpriced_flights:
        notes.append(
            f"{unpriced_flights} {'flight has' if unpriced_flights == 1 else 'flights have'} no price yet, so "
            f"{'it isn’t' if unpriced_flights == 1 else 'they aren’t'} counted."
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
        stays_total=round(sum(day.stays for day in days), 2),
        flights_total=round(sum(day.flights for day in days), 2),
        total=round(total, 2),
        budget=budget,
        over_budget_by=round(total - budget, 2) if budget is not None else None,
        unpriced_plans=unpriced,
        notes=notes,
        # Typical prices are US dollars, so a US-dollar trip needed no rates
        rates_source=exchange_rates.rates_source() if used_rates else None
    )
