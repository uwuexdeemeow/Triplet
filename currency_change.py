"""
Changing a trip's currency: every amount on the trip is converted at today's rate, so the money
still means the same thing afterwards.
"""
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import exchange_rates
import splits
from currencies import COUNTRY_CURRENCY
from models import Activity, Expense, Settlement, Trip

# The largest amounts the database columns hold (Numeric(10, 2) and Numeric(12, 2))
MAX_AMOUNT = Decimal("99999999.99")
MAX_BUDGET = Decimal("9999999999.99")
# The currencies the app's picker offers: those countries use, and the balboa, which Panama's own entry
# maps to the US dollar it circulates with
KNOWN_CURRENCIES = set(COUNTRY_CURRENCY.values()) | {"PAB"}

def convert_trip(db: Session, trip: Trip, new_currency: str, rates: dict[str, float]) -> float:
    """
    Convert the trip's budget, expenses (and how they're split), plan costs and paybacks to
    `new_currency`, set it as the trip's currency and return the rate used (1 old = rate new).

    Nothing is changed unless everything can be. The caller commits.
    """
    new_currency = new_currency.upper()
    old_currency = trip.currency
    if new_currency == old_currency:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"This trip already uses {old_currency}")
    if new_currency not in KNOWN_CURRENCIES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown currency")

    rate = exchange_rates.convert(1, old_currency, new_currency, rates)
    if rate is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Exchange rates aren’t available for that currency right now, so it can’t be converted. Try again later."
        )
    factor = Decimal(str(rate))

    def convert(amount) -> Decimal:
        return splits.cents(Decimal(str(amount)) * factor)

    expenses = db.query(Expense).filter(Expense.trip_id == trip.id).all()
    activities = db.query(Activity).filter(Activity.trip_id == trip.id, Activity.estimated_cost.isnot(None)).all()
    settlements = db.query(Settlement).filter(Settlement.trip_id == trip.id).all()

    # Work everything out first, so a problem part-way leaves the trip as it was
    budget = convert(trip.budget) if trip.budget is not None else None
    new_expenses = {expense.id: convert(expense.amount) for expense in expenses}
    new_costs = {activity.id: convert(activity.estimated_cost) for activity in activities}
    new_settlements = {settlement.id: convert(settlement.amount) for settlement in settlements}
    new_shares: dict[tuple[int, int], Decimal] = {}
    for expense in expenses:
        total = new_expenses[expense.id]
        if expense.split == "people" and expense.shares:
            for user_id, amount in splits.even_shares(total, [share.user_id for share in expense.shares]).items():
                new_shares[(expense.id, user_id)] = amount
        elif expense.split == "amounts" and expense.shares:
            converted = {share.user_id: convert(share.amount) for share in expense.shares}
            # Rounding each share can leave the sum a cent or two off the total: the biggest share absorbs it
            biggest = max(converted, key=lambda user_id: converted[user_id])
            converted[biggest] += total - sum(converted.values(), splits.cents(0))
            for user_id, amount in converted.items():
                new_shares[(expense.id, user_id)] = amount

    if (budget is not None and budget > MAX_BUDGET) or any(
        amount > MAX_AMOUNT for amount in [*new_expenses.values(), *new_costs.values(), *new_settlements.values()]
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Some amounts would be too large in {new_currency}, so this trip can’t be converted to it."
        )

    trip.currency = new_currency
    trip.budget = budget
    for expense in expenses:
        expense.amount = new_expenses[expense.id]
        for share in expense.shares:
            share.amount = new_shares.get((expense.id, share.user_id), convert(share.amount))
    for activity in activities:
        activity.estimated_cost = new_costs[activity.id]
    for settlement in settlements:
        settlement.amount = new_settlements[settlement.id]
    return rate
