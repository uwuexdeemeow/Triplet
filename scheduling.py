"""
Checks and suggestions that make a day's plan workable: is the place open, and is there time
to get from one plan to the next.

Plan times are the trip's local wall clock (stored with a UTC label), and opening hours are local
too, so the two compare directly as minutes since midnight.
"""
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

DAY_MINUTES = 24 * 60

# Google writes "11:00 AM – 3:00 PM" (sometimes "11:00 – 3:00 PM"), OpenStreetMap and people "11:00 – 15:00"
TIME_RANGE = re.compile(
    r"^(\d{1,2})(?::(\d{2}))?\s*([AP]M)?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*([AP]M)?$",
    re.IGNORECASE
)

def _to_minutes(hour: str, minute: str | None, meridiem: str | None) -> int:
    h, m = int(hour), int(minute or 0)
    if meridiem:
        h = h % 12 + (12 if meridiem.upper() == "PM" else 0)
    return h * 60 + m

def parse_hours(text: str | None) -> list[tuple[int, int]] | None:
    """
    Turn one day's opening hours into ranges of minutes since midnight.

    Returns:
        list[tuple[int, int]] | None: [] when closed, ranges past 1440 when open past midnight,
        or None when the text can't be read (so nothing is flagged by mistake).
    """
    if text is None:
        return None
    # Google puts narrow and thin no-break spaces around its times
    value = re.sub(r"[   ]", " ", text).strip()
    lowered = value.lower()
    if not value:
        return None
    if lowered == "closed":
        return []
    if lowered in ("open 24 hours", "24 hours", "24/7"):
        return [(0, DAY_MINUTES)]

    ranges = []
    for part in value.split(","):
        match = TIME_RANGE.match(part.strip())
        if not match:
            return None
        h1, m1, mer1, h2, m2, mer2 = match.groups()
        if mer1 is None and mer2 is not None:
            # "11:00 – 3:00 PM" means 11 AM; "6:00 – 10:00 PM" means 6 PM
            same = _to_minutes(h1, m1, mer2)
            mer1 = mer2 if same <= _to_minutes(h2, m2, mer2) else "AM"
        start, end = _to_minutes(h1, m1, mer1), _to_minutes(h2, m2, mer2)
        if end <= start:
            # Open past midnight, or round the clock when start and end match
            end += DAY_MINUTES
        ranges.append((start, end))
    return ranges

def hours_on(opening_hours: list[str] | None, day: date) -> list[tuple[int, int]] | None:
    """A place's open ranges on a date, including a late night carried over from the day before."""
    if not opening_hours or len(opening_hours) != 7:
        return None
    today = parse_hours(opening_hours[day.weekday()])
    if today is None:
        return None
    yesterday = parse_hours(opening_hours[(day.weekday() - 1) % 7]) or []
    carried = [(0, end - DAY_MINUTES) for start, end in yesterday if end > DAY_MINUTES]
    return carried + today

def minutes_of(value: datetime) -> int:
    return value.hour * 60 + value.minute

def is_open_during(ranges: list[tuple[int, int]], start: int, end: int) -> bool:
    return any(open_at <= start and end <= close_at for open_at, close_at in ranges)

def format_clock(minutes: int) -> str:
    minutes %= DAY_MINUTES
    return f"{minutes // 60:02d}:{minutes % 60:02d}"

def format_ranges(ranges: list[tuple[int, int]]) -> str:
    return ", ".join(f"{format_clock(start)}–{format_clock(end)}" for start, end in ranges)

def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    # Haversine: straight-line distance over the Earth's surface
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))

# Streets aren't straight lines, so real routes run about a third longer
ROUTE_FACTOR = 1.3
WALK_KMH = 4.5
# Anything this short on foot is walked, even if a train might be a little quicker
COMFORTABLE_WALK_MINUTES = 20
# Average door-to-door speed on trains and buses, by trip length: short hops stop more often and
# spend more of their time getting to the station; long ones can take express lines
TRANSIT_SPEEDS = [(4, 18), (12, 25), (math.inf, 32)]
# Walking to the station and waiting
TRANSIT_WAIT_MINUTES = 8
# Weekday rush hours, when trains are packed and roads jammed
RUSH_HOURS = [(7 * 60 + 30, 9 * 60 + 30), (17 * 60, 19 * 60 + 30)]
RUSH_SLOWDOWN = 1.35
RUSH_WAIT_MINUTES = 12
# Most trains stop running overnight, so late trips are a taxi
NIGHT = (0, 5 * 60)
TAXI_KMH = 30
TAXI_WAIT_MINUTES = 5

@dataclass
class Travel:
    minutes: int
    mode: str               # "walk" or "transit"
    km: float
    # Why it's slower or different than usual, e.g. "rush hour"
    note: str | None = None

def travel_between(lat1: float, lon1: float, lat2: float, lon2: float, depart: datetime | None = None) -> Travel:
    """
    Roughly how long it takes to get between two points in a city, leaving at a given time.

    Walks short hops; otherwise estimates a train or bus ride from the distance, slower in weekday
    rush hours and by taxi late at night. Without a time, it assumes a normal daytime trip.
    """
    km = distance_km(lat1, lon1, lat2, lon2) * ROUTE_FACTOR
    walk = km / WALK_KMH * 60

    speed = next(kmh for up_to, kmh in TRANSIT_SPEEDS if km < up_to)
    wait, note = TRANSIT_WAIT_MINUTES, None
    if depart is not None:
        clock = depart.hour * 60 + depart.minute
        if NIGHT[0] <= clock < NIGHT[1]:
            speed, wait, note = TAXI_KMH, TAXI_WAIT_MINUTES, "late at night, likely a taxi"
        elif depart.weekday() < 5 and any(start <= clock < end for start, end in RUSH_HOURS):
            speed, wait, note = speed / RUSH_SLOWDOWN, RUSH_WAIT_MINUTES, "rush hour"
    ride = km / speed * 60 + wait

    if walk <= COMFORTABLE_WALK_MINUTES or walk <= ride:
        return Travel(max(5, math.ceil(walk / 5) * 5), "walk", round(km, 1))
    return Travel(max(5, math.ceil(ride / 5) * 5), "transit", round(km, 1), note)

def travel_estimate(
    lat1: float, lon1: float, lat2: float, lon2: float, depart: datetime | None = None
) -> tuple[int, str, float]:
    """
    Roughly how long it takes to get between two points in a city.

    Returns:
        tuple[int, str, float]: minutes (rounded up to 5), "walk" or "transit", and route km.
    """
    travel = travel_between(lat1, lon1, lat2, lon2, depart)
    return travel.minutes, travel.mode, travel.km

# Plans are suggested between these times when the place has no hours
DAY_START = 9 * 60
DAY_END = 22 * 60
STEP_MINUTES = 15

def suggest_slot(
    duration: int,
    busy: list[tuple[int, int, float | None, float | None]],
    open_ranges: list[tuple[int, int]] | None,
    lat: float | None,
    lon: float | None,
    day: date | None = None
) -> tuple[int, int] | None:
    """
    The earliest start on a day that is open, free, and leaves time to travel from and to
    the plans around it.

    Args:
        duration (int): How long the visit lasts, in minutes.
        busy (list): The day's other plans as (start, end, latitude, longitude).
        open_ranges (list | None): Opening hours that day, or None if unknown.
        lat, lon: Where the new plan is, if known.
        day: The date, so travel in rush hour or late at night takes its real time.

    Returns:
        tuple[int, int] | None: start and end minutes, or None if nothing fits.
    """
    windows = open_ranges if open_ranges is not None else [(DAY_START, DAY_END)]
    # Last night's late opening (e.g. until 02:00) is a last resort, not the first suggestion
    windows = sorted(windows, key=lambda window: (window[1] <= DAY_START, window[0]))
    busy = sorted(busy)

    def travel(other_lat, other_lon, leaving: int) -> int:
        if None in (lat, lon, other_lat, other_lon):
            return 0
        depart = at(day, min(leaving, DAY_MINUTES - 1)) if day else None
        return travel_estimate(lat, lon, other_lat, other_lon, depart)[0]

    for open_at, close_at in windows:
        # Don't suggest the small hours for a place open round the clock
        start = max(open_at, DAY_START) if close_at - open_at >= DAY_MINUTES else open_at
        start = math.ceil(start / STEP_MINUTES) * STEP_MINUTES
        while start + duration <= min(close_at, DAY_MINUTES):
            end = start + duration
            clash = None
            for b_start, b_end, b_lat, b_lon in busy:
                gap = travel(b_lat, b_lon, b_end)
                if start < b_end + gap and b_start < end + gap:
                    clash = b_end + gap
                    break
            if clash is None:
                return start, end
            start = max(start + STEP_MINUTES, math.ceil(clash / STEP_MINUTES) * STEP_MINUTES)
    return None

def at(day: date, minutes: int) -> datetime:
    return datetime(day.year, day.month, day.day) + timedelta(minutes=minutes)
