"""
Rough daily spending for a trip: its plans, the meals the plans don't cover, and getting around.

Typical prices are in US dollars per person and get converted to the trip's currency. They are
deliberately middle-of-the-road; a cost someone typed in, or what they actually paid, always wins.
"""
import re

# One person's usual spend at each kind of place, in USD
CATEGORY_USD = {
    "food": 20, "cafe": 8, "bar": 20, "nightlife": 30, "attraction": 15,
    "nature": 0, "shopping": 0, "activity": 40, "other": 10,
}
# Meals a day's plans don't already cover, per person, in USD
MEAL_USD = {"breakfast": 8, "lunch": 15, "dinner": 25}
# One ride on a train, bus or short taxi share, per person, in USD
TRANSIT_RIDE_USD = 3
# "$$" on a post: how much above or below a typical price
PRICE_LEVELS = {1: 0.5, 2: 1.0, 3: 2.0, 4: 3.5}

SYMBOLS = [
    ("₩", "KRW"), ("฿", "THB"), ("₹", "INR"), ("€", "EUR"), ("£", "GBP"), ("₱", "PHP"), ("₫", "VND"),
    ("RM", "MYR"), ("元", "CNY"), ("¥", "JPY"), ("$", "USD"),
]
WORDS = {
    "yen": "JPY", "jpy": "JPY", "won": "KRW", "krw": "KRW", "baht": "THB", "thb": "THB", "euro": "EUR",
    "euros": "EUR", "eur": "EUR", "usd": "USD", "gbp": "GBP", "rmb": "CNY", "cny": "CNY", "yuan": "CNY",
    "sgd": "SGD", "hkd": "HKD", "aud": "AUD", "cad": "CAD", "nzd": "NZD", "inr": "INR", "rupees": "INR",
    "myr": "MYR", "ringgit": "MYR", "php": "PHP", "pesos": "MXN", "mxn": "MXN", "idr": "IDR", "rupiah": "IDR",
}
DOLLAR_CURRENCIES = {"USD", "SGD", "HKD", "AUD", "CAD", "NZD", "TWD", "MXN"}
NUMBER = re.compile(r"(\d+(?:[.,]\d+)*)\s*([kK])?")
# "1,000-1,500", "¥1000 ~ ¥1500", "10 to 20"
RANGE = re.compile(r"(\d+(?:[.,]\d+)*)\s*([kK])?\s*(?:-|–|—|~|to)\s*\D{0,3}?(\d+(?:[.,]\d+)*)\s*([kK])?")

def _currency_in(text: str, trip_currency: str) -> str | None:
    lowered = text.casefold()
    for word in re.findall(r"[a-z]+", lowered):
        if word in WORDS:
            return WORDS[word]
    for symbol, code in SYMBOLS:
        if symbol in text:
            # "$" on a post for a Singapore trip means Singapore dollars
            if code == "USD" and trip_currency in DOLLAR_CURRENCIES:
                return trip_currency
            if code == "JPY" and trip_currency == "CNY":
                return "CNY"
            return code
    return None

def _number(value: str, thousands: str | None) -> float:
    # "1,500" and "1.500" are thousands; "12.50" is a decimal
    if re.fullmatch(r"\d{1,3}([.,]\d{3})+", value):
        amount = float(re.sub(r"[.,]", "", value))
    else:
        amount = float(value.replace(",", "."))
    return amount * 1000 if thousands else amount

def parse_price(text: str | None, trip_currency: str) -> tuple[str, float, str | None] | None:
    """
    Read a post's price range.

    Returns:
        ("amount", per-person amount, currency or None for the trip's), ("level", multiplier, None),
        or None when there's no usable price.
    """
    if not text:
        return None
    value = text.strip()
    if re.fullmatch(r"free", value, re.IGNORECASE):
        return ("amount", 0.0, trip_currency)

    numbers = [_number(n, k) for n, k in NUMBER.findall(value)]
    if not numbers:
        symbols = re.fullmatch(r"\s*([$€£¥₩])\1{0,3}\s*", value)
        if symbols:
            return ("level", PRICE_LEVELS[len(value.strip())], None)
        return None

    # A range means somewhere in the middle; otherwise the first price, since posts often add a
    # conversion after it, like "¥8,500 ($57)"
    match = RANGE.search(value)
    if match:
        amount = (_number(*match.group(1, 2)) + _number(*match.group(3, 4))) / 2
    else:
        match = NUMBER.search(value)
        amount = numbers[0]
    # The currency right by that price: "¥" in "¥8,500 ($57)", "yen" in "1000 yen"
    before = value[max(0, match.start() - 3):match.start()]
    after = re.split(r"[(\[/,;]", value[match.end():match.end() + 10], maxsplit=1)[0]
    currency = _currency_in(before, trip_currency) or _currency_in(after, trip_currency) or _currency_in(value, trip_currency)
    return ("amount", amount, currency or trip_currency)

def meals_covered(plans: list[tuple[str | None, int]]) -> set[str]:
    """Which meals a day's food plans already are, from (category, start minute)."""
    covered = set()
    for category, start in plans:
        if category in ("food", "cafe") and 6 * 60 <= start < 11 * 60:
            covered.add("breakfast")
        elif category == "food" and 11 * 60 <= start < 16 * 60:
            covered.add("lunch")
        elif category in ("food", "bar", "nightlife") and 17 * 60 <= start < 23 * 60:
            covered.add("dinner")
    return covered
