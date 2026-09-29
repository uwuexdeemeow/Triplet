"""
Who owes what on a trip: splitting an expense, and the fewest payments that settle everyone up.

Money is handled in cents so shares always add up to the exact total.
"""
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")

def cents(amount) -> Decimal:
    return Decimal(str(amount)).quantize(CENT, rounding=ROUND_HALF_UP)

def even_shares(total, user_ids: list[int]) -> dict[int, Decimal]:
    """Split `total` evenly; the spare cents go to the first people, so it adds up exactly."""
    total_cents = int(cents(total) * 100)
    base, spare = divmod(total_cents, len(user_ids))
    return {user_id: Decimal(base + (1 if index < spare else 0)) / 100 for index, user_id in enumerate(user_ids)}

def settle_up(balances: dict[int, Decimal]) -> list[tuple[int, int, Decimal]]:
    """
    Payments (from, to, amount) that bring every balance to zero, using as few as it can:
    whoever owes most pays whoever is owed most, until everyone is even.

    A positive balance means someone is owed money, negative that they owe it.
    """
    owed = sorted(((cents(b), user) for user, b in balances.items() if cents(b) > 0), reverse=True)
    owing = sorted(((-cents(b), user) for user, b in balances.items() if cents(b) < 0), reverse=True)
    owed = [[amount, user] for amount, user in owed]
    owing = [[amount, user] for amount, user in owing]

    payments = []
    while owed and owing:
        owed.sort(reverse=True)
        owing.sort(reverse=True)
        creditor, debtor = owed[0], owing[0]
        amount = min(creditor[0], debtor[0])
        payments.append((debtor[1], creditor[1], amount))
        creditor[0] -= amount
        debtor[0] -= amount
        owed = [entry for entry in owed if entry[0] > 0]
        owing = [entry for entry in owing if entry[0] > 0]
    return payments
