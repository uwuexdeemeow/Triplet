"""
Turn everyone's saved places into a draft plan for the trip.

Places saved by several people are merged into one and go first. Each place goes on the day
where it's open and closest to what's already planned, at a time that suits it (lunch or dinner
for food, evenings for bars) and leaves room to travel between stops.
"""
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date

import scheduling

# How long a visit usually takes, and the times of day it suits
VISIT_MINUTES = {
    "food": 75, "cafe": 45, "bar": 90, "nightlife": 120, "attraction": 90,
    "nature": 120, "shopping": 60, "activity": 90, "other": 60,
}
PREFERRED_WINDOWS = {
    "food": [(12 * 60, 14 * 60 + 30), (18 * 60, 21 * 60)],
    "cafe": [(10 * 60, 12 * 60), (14 * 60 + 30, 17 * 60)],
    "bar": [(19 * 60, 24 * 60)],
    "nightlife": [(21 * 60, 24 * 60)],
    "attraction": [(9 * 60, 18 * 60)],
    "nature": [(8 * 60, 17 * 60)],
    "shopping": [(11 * 60, 19 * 60)],
    "activity": [(9 * 60, 18 * 60)],
}
# More than this a day stops being a holiday
MAX_PLANS_PER_DAY = 5
# Saved twice within this distance is the same place, even if the names are spelled differently
SAME_PLACE_KM = 0.15
# The same name further apart than this is probably a different branch
SAME_NAME_MAX_KM = 2.0

@dataclass
class Candidate:
    place_id: int
    name: str
    category: str | None
    latitude: float | None
    longitude: float | None
    opening_hours: list[str] | None
    saved_by: str | None
    # Already in the plan: only here so other people's copies of it aren't suggested again
    planned: bool = False

@dataclass
class Busy:
    day: date
    start: int
    end: int
    latitude: float | None
    longitude: float | None

@dataclass
class Group:
    place: Candidate
    place_ids: list[int]
    saved_by: list[str]

@dataclass
class Proposal:
    place_id: int
    name: str
    day: date
    start: int
    end: int
    saved_by: list[str]
    merged_place_ids: list[int]
    reason: str

@dataclass
class Unplaced:
    place_id: int
    name: str
    reason: str

@dataclass
class Draft:
    proposals: list[Proposal] = field(default_factory=list)
    unplaced: list[Unplaced] = field(default_factory=list)
    merged_count: int = 0

def normalize_name(name: str) -> str:
    # "Café Kitsuné!" and "cafe kitsune" are the same
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().casefold()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()

def _distance(a: Candidate, b: Candidate) -> float | None:
    if None in (a.latitude, a.longitude, b.latitude, b.longitude):
        return None
    return scheduling.distance_km(a.latitude, a.longitude, b.latitude, b.longitude)

def _same_place(a: Candidate, b: Candidate) -> bool:
    distance = _distance(a, b)
    if normalize_name(a.name) == normalize_name(b.name) and normalize_name(a.name):
        return distance is None or distance <= SAME_NAME_MAX_KM
    return distance is not None and distance <= SAME_PLACE_KM

def _detail(place: Candidate) -> int:
    # Prefer the copy with a pin and opening hours
    return (place.latitude is not None) + (place.opening_hours is not None)

def merge_duplicates(candidates: list[Candidate]) -> list[Group]:
    """Group places that several people saved, e.g. from different TikToks of the same ramen shop."""
    parent = list(range(len(candidates)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, a in enumerate(candidates):
        for j in range(i + 1, len(candidates)):
            if _same_place(a, candidates[j]):
                parent[find(j)] = find(i)

    members: dict[int, list[Candidate]] = {}
    for i, candidate in enumerate(candidates):
        members.setdefault(find(i), []).append(candidate)

    groups = []
    for places in members.values():
        best = max(places, key=lambda place: (_detail(place), -place.place_id))
        savers = []
        for place in places:
            if place.saved_by and place.saved_by not in savers:
                savers.append(place.saved_by)
        groups.append(Group(place=best, place_ids=sorted(p.place_id for p in places), saved_by=savers))
    return groups

def _intersect(a: list[tuple[int, int]], b: list[tuple[int, int]]) -> list[tuple[int, int]]:
    result = []
    for a_start, a_end in a:
        for b_start, b_end in b:
            start, end = max(a_start, b_start), min(a_end, b_end)
            if end > start:
                result.append((start, end))
    return sorted(result)

def _nearest_km(place: Candidate, busy: list[Busy]) -> float | None:
    distances = [
        scheduling.distance_km(place.latitude, place.longitude, b.latitude, b.longitude)
        for b in busy
        if place.latitude is not None and b.latitude is not None and b.longitude is not None
    ]
    return min(distances) if distances else None

def _stay_km(place: Candidate, points: list[tuple[float, float]]) -> float | None:
    if place.latitude is None or place.longitude is None or not points:
        return None
    return min(scheduling.distance_km(place.latitude, place.longitude, lat, lon) for lat, lon in points)

def draft_plan(
    days: list[date],
    candidates: list[Candidate],
    planned: list[Busy],
    stays: dict[date, list[tuple[float, float]]] | None = None
) -> Draft:
    """
    Args:
        days (list[date]): Every day of the trip.
        candidates (list[Candidate]): Every saved place; ones marked planned are left alone.
        planned (list[Busy]): What's already planned, which stays where it is.
        stays (dict): Where each day starts and ends, as (latitude, longitude): the hotel slept at
            the night before and the one that night. Places near them suit that day.
    """
    stays = stays or {}
    draft = Draft()
    busy_by_day: dict[date, list[Busy]] = {day: [] for day in days}
    for item in planned:
        if item.day in busy_by_day:
            busy_by_day[item.day].append(item)

    by_id = {candidate.place_id: candidate for candidate in candidates}
    planned_ids = {candidate.place_id for candidate in candidates if candidate.planned}
    groups = []
    for group in merge_duplicates(candidates):
        if not planned_ids & set(group.place_ids):
            groups.append(group)
            continue
        # Someone else's copy of a place that's already planned: say so, rather than leaving it out silently
        for place_id in group.place_ids:
            if place_id not in planned_ids:
                draft.unplaced.append(Unplaced(place_id, by_id[place_id].name, "Already in the plan from another save"))
    draft.merged_count = sum(len(group.place_ids) - 1 for group in groups)
    # Places more people saved go first, so they get the best days
    groups.sort(key=lambda group: (-len(group.saved_by), group.place.place_id))

    for group in groups:
        place = group.place
        if place.category == "accommodation":
            draft.unplaced.append(Unplaced(place.place_id, place.name, "Places to stay aren’t added as plans. Add it as where you’re staying instead."))
            continue

        duration = VISIT_MINUTES.get(place.category or "other", 60)
        preferred = PREFERRED_WINDOWS.get(place.category or "other")
        options = []
        closed_every_day = True
        for index, day in enumerate(days):
            ranges = scheduling.hours_on(place.opening_hours, day)
            if ranges == []:
                continue
            closed_every_day = False
            busy = busy_by_day[day]
            if len(busy) >= MAX_PLANS_PER_DAY:
                continue

            busy_slots = [(b.start, b.end, b.latitude, b.longitude) for b in busy]
            slot = None
            if preferred:
                slot = scheduling.suggest_slot(
                    duration, busy_slots, _intersect(preferred, ranges) if ranges else preferred,
                    place.latitude, place.longitude, day
                )
            if slot is None:
                slot = scheduling.suggest_slot(duration, busy_slots, ranges, place.latitude, place.longitude, day)
            if slot is None:
                continue

            # Close to the day's other stops or its hotel beats a quiet day; earlier days break ties
            nearest = _nearest_km(place, busy)
            hotel = _stay_km(place, stays.get(day, []))
            closest = min((km for km in (nearest, hotel) if km is not None), default=None)
            score = (closest if closest is not None else 5.0) + len(busy) * 1.5 + index * 0.01
            options.append((score, day, slot, nearest, hotel))

        if not options:
            reason = "Closed every day of the trip" if closed_every_day and place.opening_hours else "No free time left on the days it’s open"
            draft.unplaced.append(Unplaced(place.place_id, place.name, reason))
            continue

        _, day, (start, end), nearest, hotel = min(options, key=lambda option: option[0])
        if len(group.saved_by) > 1:
            reason = f"Saved by {len(group.saved_by)} people"
        elif nearest is not None and nearest < 1.5 and (hotel is None or nearest <= hotel):
            reason = "Near your other plans that day"
        elif hotel is not None and hotel < 1.5:
            reason = "Near where you’re staying that day"
        elif place.opening_hours:
            reason = "Open then"
        else:
            reason = "A free spot in the day"

        busy_by_day[day].append(Busy(day, start, end, place.latitude, place.longitude))
        draft.proposals.append(Proposal(
            place_id=place.place_id,
            name=place.name,
            day=day,
            start=start,
            end=end,
            saved_by=group.saved_by,
            merged_place_ids=[place_id for place_id in group.place_ids if place_id != place.place_id],
            reason=reason
        ))

    draft.proposals.sort(key=lambda proposal: (proposal.day, proposal.start))
    return draft
