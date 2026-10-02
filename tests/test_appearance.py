"""How trips look (style, colour, buddies, cover photo) and people's avatar buddies."""
import pytest

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

LOOK = {
    "style": "poster", "colour": "lagoon", "scene": "beach",
    "buddies": {"pixel": "cat", "poster": "whale", "postcard": None, "stickers": "sun"},
    "pattern": "emoji", "emoji": "🌸",
}

def set_look(client, user, trip, look):
    return client.put(f"/trips/{trip['id']}/appearance", headers=user["headers"], json=look)

def upload_cover(client, user, trip, data=PNG):
    return client.put(f"/trips/{trip['id']}/cover", headers=user["headers"], files={"file": ("cover.png", data, "image/png")})

@pytest.fixture
def guest_headers(client, alice, trip):
    code = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": "123456"}).json()["access_code"]
    response = client.post("/guest/access", json={"access_code": code, "pin": "123456"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}

# ---------- The trip's look ----------

def test_new_trips_have_the_default_look(trip):
    assert trip["appearance"] == {
        "style": "pixel", "colour": "harbour", "scene": "city",
        "buddies": {"pixel": "robot", "poster": "fox", "postcard": "tram", "stickers": "onigiri"},
        "pattern": "dots", "emoji": "🍜",
    }
    assert trip["cover_url"] is None

def test_a_member_changes_the_look_for_everyone(client, alice, bob, trip, add_member):
    add_member(bob)

    response = set_look(client, bob, trip, LOOK)

    assert response.status_code == 200, response.text
    assert response.json()["appearance"] == LOOK
    assert client.get(f"/trips/{trip['id']}", headers=alice["headers"]).json()["appearance"] == LOOK
    assert client.get("/trips", headers=alice["headers"]).json()[0]["appearance"] == LOOK

def test_left_out_choices_take_their_defaults(client, alice, trip):
    response = set_look(client, alice, trip, {"style": "solid", "colour": "plum"})

    assert response.json()["appearance"]["buddies"]["poster"] == "fox"
    assert response.json()["appearance"]["pattern"] == "dots"

def test_viewers_cant_change_the_look(client, bob, trip, add_member):
    add_member(bob, role="viewer")

    assert set_look(client, bob, trip, LOOK).status_code == 403
    assert upload_cover(client, bob, trip).status_code == 403

def test_people_outside_the_trip_cant_change_the_look(client, eve, trip):
    assert set_look(client, eve, trip, LOOK).status_code in (403, 404)
    assert upload_cover(client, eve, trip).status_code in (403, 404)

def test_guests_see_the_look_but_cant_change_it(client, alice, trip, guest_headers):
    set_look(client, alice, trip, LOOK)

    assert client.get("/guest/trip", headers=guest_headers).json()["appearance"] == LOOK
    assert client.put(f"/trips/{trip['id']}/appearance", headers=guest_headers, json=LOOK).status_code in (401, 403)

@pytest.mark.parametrize("change", [
    {"style": "neon"},
    {"colour": "#ff0000"},
    {"scene": "moon"},
    {"pattern": "plaid"},
    # Only emoji from the list, never any text
    {"emoji": "<script>"},
    {"emoji": "🍜🍜"},
    # A buddy from another style's cast
    {"buddies": {"pixel": "fox"}},
    {"buddies": {"poster": "robot"}},
    # Styles without buddies can't have one
    {"buddies": {"topo": "fox"}},
    {"surprise": True},
])
def test_only_listed_choices_are_saved(client, alice, trip, change):
    assert set_look(client, alice, trip, {**LOOK, **change}).status_code == 422
    assert client.get(f"/trips/{trip['id']}", headers=alice["headers"]).json()["appearance"]["style"] == "pixel"

# ---------- Cover photos ----------

def test_upload_and_serve_a_cover(client, alice, trip):
    response = upload_cover(client, alice, trip)

    assert response.status_code == 200, response.text
    cover_url = response.json()["cover_url"]
    assert cover_url.startswith(f"/trips/{trip['id']}/cover?v=")
    photo = client.get(cover_url)
    assert photo.status_code == 200
    assert photo.content == PNG
    assert photo.headers["content-type"] == "image/png"

def test_cover_addresses_cant_be_guessed_or_reused(client, alice, trip, make_user):
    cover_url = upload_cover(client, alice, trip).json()["cover_url"]
    version = cover_url.split("v=")[1].split("&")[0]

    assert client.get(f"/trips/{trip['id']}/cover").status_code == 404
    assert client.get(f"/trips/{trip['id']}/cover?v={version}&sig=0").status_code == 404
    # The same photo on another trip has its own signature
    other = client.post("/trips", headers=alice["headers"], json={
        "title": "Kyoto", "destination": "Kyoto", "start_date": "2026-11-01", "end_date": "2026-11-03"
    }).json()
    upload_cover(client, alice, other)
    assert client.get(cover_url.replace(f"/trips/{trip['id']}/", f"/trips/{other['id']}/")).status_code == 404

def test_an_old_cover_address_stops_working(client, alice, trip):
    first = upload_cover(client, alice, trip).json()["cover_url"]
    second = upload_cover(client, alice, trip, PNG + b"x").json()["cover_url"]

    assert first != second
    assert client.get(first).status_code == 404
    assert client.get(second).status_code == 200

def test_covers_must_be_small_images(client, alice, trip):
    assert upload_cover(client, alice, trip, b"hello").status_code == 422
    assert upload_cover(client, alice, trip, PNG + b"\x00" * (900 * 1024)).status_code == 413

def test_remove_a_cover(client, alice, trip):
    cover_url = upload_cover(client, alice, trip).json()["cover_url"]

    response = client.delete(f"/trips/{trip['id']}/cover", headers=alice["headers"])

    assert response.json()["cover_url"] is None
    assert client.get(cover_url).status_code == 404

def test_deleting_the_trip_deletes_its_cover(client, alice, trip):
    cover_url = upload_cover(client, alice, trip).json()["cover_url"]

    assert client.delete(f"/trips/{trip['id']}", headers=alice["headers"]).status_code == 204
    assert client.get(cover_url).status_code == 404

# ---------- Avatar buddies ----------

def test_pick_and_clear_an_avatar_buddy(client, alice):
    response = client.patch("/users/me", headers=alice["headers"], json={"avatar_buddy": "penguin"})
    assert response.status_code == 200, response.text
    assert response.json()["avatar_buddy"] == "penguin"

    # Changing something else leaves it alone
    assert client.patch("/users/me", headers=alice["headers"], json={"name": "Alice"}).json()["avatar_buddy"] == "penguin"

    assert client.patch("/users/me", headers=alice["headers"], json={"avatar_buddy": None}).json()["avatar_buddy"] is None

@pytest.mark.parametrize("buddy", ["robot", "tram", "dragon", ""])
def test_avatar_buddies_come_from_the_flat_casts(client, alice, buddy):
    # 8-bit and stamp drawings only suit banners, not avatars
    assert client.patch("/users/me", headers=alice["headers"], json={"avatar_buddy": buddy}).status_code == 422

def test_trip_mates_see_each_others_buddies(client, alice, bob, trip, add_member):
    add_member(bob)
    client.patch("/users/me", headers=bob["headers"], json={"avatar_buddy": "onigiri"})

    members = client.get(f"/trips/{trip['id']}/members", headers=alice["headers"]).json()
    previews = client.get("/trips", headers=alice["headers"]).json()[0]["members"]

    assert next(m for m in members if m["user_id"] == bob["id"])["avatar_buddy"] == "onigiri"
    assert next(m for m in previews if m["user_id"] == bob["id"])["avatar_buddy"] == "onigiri"
