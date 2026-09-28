import pytest

import assistant
from config import settings
from models import Activity, ExtractedPlace, SavedLink

HOTEL = (35.6938, 139.7034)      # Shinjuku
NEAR_CAFE = (35.6960, 139.7010)  # a few hundred metres away
FAR_CAFE = (35.7148, 139.7967)   # Asakusa, across town

def spot(key, name, lat=None, lon=None, **extra):
    return assistant.Spot(key=key, name=name, kind="saved place", details={}, latitude=lat, longitude=lon, **extra)

def context(*spots):
    return assistant.TripContext(title="Tokyo", destination="Tokyo", dates=None, currency="JPY", spots=list(spots))

def tools(ctx):
    places_near, travel_time = assistant._tools(ctx)
    return places_near, travel_time

def test_places_near_lists_what_is_close_nearest_first():
    ctx = context(
        spot("place-1", "Hotel", *HOTEL),
        spot("place-2", "Far Cafe", *FAR_CAFE),
        spot("place-3", "Near Cafe", *NEAR_CAFE),
        spot("place-4", "No pin"),
    )
    places_near, _ = tools(ctx)

    within_ten = places_near("place-1", 10)
    everything = places_near("place-1", 120)

    assert [item["name"] for item in within_ten] == ["Near Cafe"]
    assert within_ten[0]["mode"] == "walk"
    assert [item["name"] for item in everything] == ["Near Cafe", "Far Cafe"]

def test_places_near_explains_a_missing_pin():
    places_near, _ = tools(context(spot("place-1", "Hotel")))

    assert "no map pin" in places_near("place-1", 10)[0]["error"]
    assert "No place" in places_near("place-9", 10)[0]["error"]

def test_travel_time():
    _, travel_time = tools(context(spot("place-1", "Hotel", *HOTEL), spot("place-2", "Far Cafe", *FAR_CAFE)))

    result = travel_time("place-1", "place-2")

    assert result["mode"] == "transit"
    assert result["minutes"] >= 20

def test_mentioned_spots_prefer_the_longest_name_in_order():
    ctx = context(spot("place-1", "Ichiran"), spot("place-2", "Ichiran Shibuya"), spot("place-3", "Glitch Coffee"))

    found = assistant.mentioned_spots("Try Glitch Coffee first, then ichiran shibuya for dinner.", ctx)

    assert [s.name for s in found] == ["Glitch Coffee", "Ichiran Shibuya"]

def test_no_key_is_a_clear_error(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", None)

    with pytest.raises(assistant.AssistantError, match="set up"):
        assistant.ask("Where should we eat?", context())

@pytest.fixture
def trip_with_places(db, trip, alice):
    link = SavedLink(trip_id=trip["id"], url="https://www.tiktok.com/@a/video/1", platform="tiktok",
                     added_by_id=alice["id"], title="Stay and eat in Shinjuku", summary="A hotel and a cafe")
    db.add(link)
    db.flush()
    hotel = ExtractedPlace(link_id=link.id, name="Park Hyatt Tokyo", category="accommodation",
                           latitude=HOTEL[0], longitude=HOTEL[1], details_status="found")
    cafe = ExtractedPlace(link_id=link.id, name="Glitch Coffee", category="cafe", price_range="¥800",
                          opening_hours=["08:00 – 17:00"] * 7, latitude=NEAR_CAFE[0], longitude=NEAR_CAFE[1],
                          details_status="found")
    db.add_all([hotel, cafe])
    db.flush()
    from datetime import datetime
    db.add(Activity(trip_id=trip["id"], place_id=cafe.id, source_link_id=link.id, title="Glitch Coffee",
                    location="Glitch Coffee, Tokyo", start_time=datetime(2026, 10, 1, 9), end_time=datetime(2026, 10, 1, 10)))
    db.commit()
    return {"hotel": hotel.id, "cafe": cafe.id}

def test_ask_sends_the_trip_and_links_the_answer(client, alice, trip, trip_with_places, monkeypatch):
    seen = {}

    def fake_ask(question, ctx):
        seen["question"] = question
        seen["ctx"] = ctx
        return assistant.Answer(
            text="Glitch Coffee is about a 5 min walk from Park Hyatt Tokyo.",
            mentioned=assistant.mentioned_spots("Glitch Coffee Park Hyatt Tokyo", ctx),
        )
    monkeypatch.setattr(assistant, "ask", fake_ask)

    response = client.post(f"/trips/{trip['id']}/ask", headers=alice["headers"], json={"question": "  Cafés near our hotel?  "})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["answer"].startswith("Glitch Coffee")
    assert body["mentions"][0] == {"kind": "place", "id": trip_with_places["cafe"], "name": "Glitch Coffee"}
    assert seen["question"] == "Cafés near our hotel?"
    hotel = seen["ctx"].find(f"place-{trip_with_places['hotel']}")
    assert hotel.details["category"] == "accommodation"
    assert hotel.details["saved_by"] == "alice"
    cafe = seen["ctx"].find(f"place-{trip_with_places['cafe']}")
    assert cafe.details["in_the_plan_at"] == ["Thu 01 Oct 09:00"]
    assert any(s.kind == "plan" and s.name == "Glitch Coffee" for s in seen["ctx"].spots)

def test_viewers_can_ask(client, bob, trip, add_member, monkeypatch):
    add_member(bob, role="viewer")
    monkeypatch.setattr(assistant, "ask", lambda question, ctx: assistant.Answer(text="Nothing saved yet.", mentioned=[]))

    response = client.post(f"/trips/{trip['id']}/ask", headers=bob["headers"], json={"question": "What's saved?"})

    assert response.status_code == 200

def test_people_outside_the_trip_cannot_ask(client, eve, trip):
    response = client.post(f"/trips/{trip['id']}/ask", headers=eve["headers"], json={"question": "What's saved?"})

    assert response.status_code in (403, 404)

def test_ai_trouble_is_a_friendly_error(client, alice, trip, monkeypatch):
    def broken(question, ctx):
        raise assistant.AssistantError("The AI service is busy right now. Try again in a minute.")
    monkeypatch.setattr(assistant, "ask", broken)

    response = client.post(f"/trips/{trip['id']}/ask", headers=alice["headers"], json={"question": "What's saved?"})

    assert response.status_code == 503
    assert response.json()["detail"].startswith("The AI service is busy")
