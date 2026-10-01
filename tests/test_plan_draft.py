from datetime import date

import pytest

import planner
from models import Activity, ExtractedPlace, SavedLink

DAYS = [date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 3)]

def candidate(place_id, name, category="food", lat=None, lon=None, hours=None, saved_by="alice", planned=False):
    return planner.Candidate(place_id, name, category, lat, lon, hours, saved_by, planned)

def test_merges_the_same_place_saved_by_different_people():
    groups = planner.merge_duplicates([
        candidate(1, "Café Kitsuné", saved_by="alice"),
        candidate(2, "cafe kitsune!", saved_by="bob", lat=35.66, lon=139.70),
        candidate(3, "Menya Itto", saved_by="bob"),
    ])

    kitsune = next(group for group in groups if 1 in group.place_ids)
    assert kitsune.place_ids == [1, 2]
    assert kitsune.saved_by == ["alice", "bob"]
    # The copy with a map pin is kept
    assert kitsune.place.place_id == 2

def test_merges_different_names_at_the_same_spot():
    groups = planner.merge_duplicates([
        candidate(1, "Ichiran Shibuya", lat=35.6604, lon=139.7010),
        candidate(2, "一蘭 渋谷店", lat=35.6605, lon=139.7011),
    ])

    assert len(groups) == 1

def test_keeps_far_apart_branches_separate():
    groups = planner.merge_duplicates([
        candidate(1, "Ichiran", lat=35.6604, lon=139.7010),
        candidate(2, "Ichiran", lat=35.7100, lon=139.7960),
    ])

    assert len(groups) == 2

def test_places_saved_by_more_people_go_first():
    # Only one day with room for one more plan, so only the popular place fits
    planned = [planner.Busy(DAYS[0], 9 * 60 + i * 60, 9 * 60 + i * 60 + 30, None, None) for i in range(4)]
    draft = planner.draft_plan([DAYS[0]], [
        candidate(1, "Quiet bar", category="bar", saved_by="alice"),
        candidate(2, "Menya Itto", saved_by="alice"),
        candidate(3, "menya itto", saved_by="bob"),
    ], planned)

    assert [item.name for item in draft.proposals] == ["Menya Itto"]
    assert draft.proposals[0].saved_by == ["alice", "bob"]
    assert draft.proposals[0].reason == "Saved by 2 people"
    assert draft.merged_count == 1
    assert [item.name for item in draft.unplaced] == ["Quiet bar"]

def test_food_goes_at_lunch_and_bars_in_the_evening():
    draft = planner.draft_plan([DAYS[0]], [
        candidate(1, "Ramen", category="food"),
        candidate(2, "Bar", category="bar"),
    ], [])

    times = {item.name: item.start for item in draft.proposals}
    assert times["Ramen"] == 12 * 60
    assert times["Bar"] == 19 * 60

def test_skips_days_the_place_is_closed():
    # 1 October 2026 is a Thursday
    hours = ["11:00 – 22:00"] * 3 + ["Closed"] + ["11:00 – 22:00"] * 3
    draft = planner.draft_plan(DAYS, [candidate(1, "Ramen", hours=hours)], [])

    assert draft.proposals[0].day == DAYS[1]

def test_reports_places_closed_all_trip():
    draft = planner.draft_plan(DAYS, [candidate(1, "Ramen", hours=["Closed"] * 7)], [])

    assert draft.proposals == []
    assert draft.unplaced[0].reason == "Closed every day of the trip"

def test_puts_places_near_what_is_already_planned():
    planned = [planner.Busy(DAYS[2], 10 * 60, 11 * 60, 35.7148, 139.7967)]
    draft = planner.draft_plan(DAYS, [candidate(1, "Asakusa snack", category="food", lat=35.7150, lon=139.7960)], planned)

    assert draft.proposals[0].day == DAYS[2]
    assert draft.proposals[0].reason == "Near your other plans that day"

def test_puts_places_near_that_days_hotel():
    # Day 2 starts at a Shinjuku hotel; day 3 starts and ends in Asakusa
    stays = {DAYS[1]: [(35.6938, 139.7034)], DAYS[2]: [(35.7148, 139.7967)]}
    draft = planner.draft_plan(DAYS, [candidate(1, "Asakusa snack", category="food", lat=35.7150, lon=139.7960)], [], stays)

    assert draft.proposals[0].day == DAYS[2]
    assert draft.proposals[0].reason == "Near where you’re staying that day"

def test_leaves_hotels_out():
    draft = planner.draft_plan(DAYS, [candidate(1, "Hotel", category="accommodation")], [])

    assert draft.proposals == []
    assert draft.unplaced[0].reason.startswith("Places to stay")

def test_skips_places_someone_already_planned():
    draft = planner.draft_plan(DAYS, [
        candidate(1, "Menya Itto", saved_by="alice", planned=True),
        candidate(2, "Menya Itto", saved_by="bob"),
    ], [])

    assert draft.proposals == []
    # Bob's copy is listed, so it's clear why it isn't suggested
    assert [(u.place_id, u.reason) for u in draft.unplaced] == [(2, "Already in the plan from another save")]

@pytest.fixture
def save_place(db, trip):
    def _save_place(name: str, user: dict, **fields) -> int:
        link = SavedLink(
            trip_id=trip["id"], url=f"https://www.tiktok.com/@a/video/{abs(hash(name + user['email']))}",
            platform="tiktok", added_by_id=user["id"]
        )
        db.add(link)
        db.flush()
        place = ExtractedPlace(link_id=link.id, name=name, details_status="found", **fields)
        db.add(place)
        db.commit()
        return place.id
    return _save_place

def test_draft_and_apply(client, alice, bob, trip, add_member, save_place, db):
    add_member(bob)
    itto = save_place("Menya Itto", alice, category="food", city="Tokyo")
    save_place("menya itto", bob, category="food")
    save_place("Park Hyatt", bob, category="accommodation")

    response = client.post(f"/trips/{trip['id']}/plan-draft", headers=bob["headers"])

    assert response.status_code == 200, response.text
    draft = response.json()
    assert draft["merged_count"] == 1
    assert [item["name"] for item in draft["items"]] == ["Menya Itto"]
    item = draft["items"][0]
    assert sorted(item["saved_by"]) == ["alice", "bob"]
    assert [skipped["name"] for skipped in draft["skipped"]] == ["Park Hyatt"]
    # Drafting doesn't change the plan
    assert db.query(Activity).count() == 0

    response = client.post(f"/trips/{trip['id']}/plan-draft/apply", headers=bob["headers"], json={
        "items": [{"place_id": item["place_id"], "start_time": item["start_time"], "end_time": item["end_time"]}]
    })

    assert response.status_code == 201, response.text
    activity = response.json()[0]
    assert activity["place_id"] == item["place_id"] == itto
    assert activity["title"] == "Menya Itto"
    # Once it's planned, nobody's copy is suggested again
    assert client.post(f"/trips/{trip['id']}/plan-draft", headers=alice["headers"]).json()["items"] == []

def test_apply_is_all_or_nothing(client, alice, trip, save_place, db):
    itto = save_place("Menya Itto", alice, category="food")

    response = client.post(f"/trips/{trip['id']}/plan-draft/apply", headers=alice["headers"], json={"items": [
        {"place_id": itto, "start_time": "2026-10-01T12:00:00Z", "end_time": "2026-10-01T13:00:00Z"},
        {"place_id": 99999, "start_time": "2026-10-01T14:00:00Z", "end_time": "2026-10-01T15:00:00Z"},
    ]})

    assert response.status_code == 404
    assert db.query(Activity).count() == 0

def test_apply_rejects_times_outside_the_trip(client, alice, trip, save_place):
    itto = save_place("Menya Itto", alice, category="food")

    response = client.post(f"/trips/{trip['id']}/plan-draft/apply", headers=alice["headers"], json={"items": [
        {"place_id": itto, "start_time": "2027-01-01T12:00:00Z", "end_time": "2027-01-01T13:00:00Z"},
    ]})

    assert response.status_code == 400

def test_viewers_cannot_draft(client, bob, trip, add_member):
    add_member(bob, role="viewer")

    assert client.post(f"/trips/{trip['id']}/plan-draft", headers=bob["headers"]).status_code == 403
