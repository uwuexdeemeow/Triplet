"""
Answer questions about a trip's saves and plans, like "Which cafés we saved are within a
10-minute walk of our hotel?"

Gemini gets the trip as data, plus two small tools so it never has to guess distances: what's
within some minutes of a place, and how long it takes between two. Both use the same estimates
as the rest of the app (scheduling.travel_estimate).
"""
import json
import logging
from dataclasses import dataclass, field

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

import scheduling
from config import settings

logger = logging.getLogger("triplet.assistant")

RETRYABLE_CODES = {429, 500, 502, 503, 504}

class AssistantError(Exception):
    """Raised with a message that is safe to show to users."""

@dataclass
class Spot:
    """A saved place or a plan, as the assistant sees it."""
    key: str                    # "place-12" or "plan-5"
    name: str
    kind: str                   # "saved place" or "plan"
    details: dict
    latitude: float | None = None
    longitude: float | None = None
    place_id: int | None = None
    activity_id: int | None = None

@dataclass
class TripContext:
    title: str
    destination: str | None
    dates: str | None
    currency: str
    spots: list[Spot] = field(default_factory=list)

    def find(self, key: str) -> Spot | None:
        return next((spot for spot in self.spots if spot.key == key), None)

SYSTEM = """You help a group plan a trip with Triplet. Answer questions about the places they saved
(from TikToks and other posts) and the plans they made, using ONLY the trip data below and the tools.

- Distances and travel times: never estimate them yourself. Use places_near or travel_time.
  Travel times are rough estimates from straight-line distance, so say "about".
- "Our hotel", "where we stay": a saved place with category accommodation. If there is none, say so.
- Refer to places by their exact names from the data so the app can link them.
- If the data doesn't answer the question, say what's missing (for example, a place has no map pin
  or no opening hours) instead of guessing. Don't add facts from outside the data.
- Keep it short: a sentence or two, then a list if there are several places. No markdown headings.

Trip data (JSON):
"""

def _spot_json(spot: Spot) -> dict:
    return {"id": spot.key, "name": spot.name, "type": spot.kind, **spot.details}

def _tools(context: TripContext):
    def places_near(spot_id: str, max_minutes: int) -> list[dict]:
        """List the saved places and plans within a travel time of one place or plan.

        Args:
            spot_id: The id of a place or plan from the trip data, like "place-12".
            max_minutes: The longest travel time to include, in minutes.

        Returns:
            Each nearby place with its estimated minutes, whether that's walking or transit, and km,
            nearest first. An error entry if the spot has no map pin.
        """
        origin = context.find(spot_id)
        if origin is None:
            return [{"error": f"No place or plan with id {spot_id}"}]
        if origin.latitude is None or origin.longitude is None:
            return [{"error": f"{origin.name} has no map pin, so distances from it are unknown"}]
        nearby = []
        for spot in context.spots:
            if spot.key == origin.key or spot.latitude is None or spot.longitude is None:
                continue
            minutes, mode, km = scheduling.travel_estimate(origin.latitude, origin.longitude, spot.latitude, spot.longitude)
            if minutes <= max_minutes:
                nearby.append({"id": spot.key, "name": spot.name, "type": spot.kind, "minutes": minutes, "mode": mode, "km": km})
        return sorted(nearby, key=lambda item: item["minutes"])

    def travel_time(from_id: str, to_id: str) -> dict:
        """Estimate the travel time between two places or plans.

        Args:
            from_id: The id of the starting place or plan, like "place-12".
            to_id: The id of the destination place or plan.

        Returns:
            Estimated minutes, "walk" or "transit", and km; or an error if either has no map pin.
        """
        a, b = context.find(from_id), context.find(to_id)
        if a is None or b is None:
            return {"error": "Unknown id"}
        if None in (a.latitude, a.longitude, b.latitude, b.longitude):
            return {"error": "One of them has no map pin"}
        minutes, mode, km = scheduling.travel_estimate(a.latitude, a.longitude, b.latitude, b.longitude)
        return {"minutes": minutes, "mode": mode, "km": km}

    return [places_near, travel_time]

@dataclass
class Answer:
    text: str
    # The places and plans the answer names, in the order they appear, for the app to link
    mentioned: list[Spot]

def mentioned_spots(text: str, context: TripContext) -> list[Spot]:
    """Which places and plans an answer names, longest names first so "Ichiran Shibuya" beats "Ichiran"."""
    lowered = text.casefold()
    found: dict[str, tuple[int, Spot]] = {}
    taken: list[tuple[int, int]] = []
    for spot in sorted(context.spots, key=lambda spot: -len(spot.name)):
        name = spot.name.casefold().strip()
        if len(name) < 3:
            continue
        start = lowered.find(name)
        while start != -1:
            end = start + len(name)
            if not any(s < end and start < e for s, e in taken):
                taken.append((start, end))
                found.setdefault(spot.name.casefold(), (start, spot))
                break
            start = lowered.find(name, end)
    return [spot for _, spot in sorted(found.values(), key=lambda item: item[0])]

def ask(question: str, context: TripContext) -> Answer:
    if not settings.GEMINI_API_KEY:
        raise AssistantError("Questions aren't set up on this server yet")

    data = {
        "trip": {"title": context.title, "destination": context.destination, "dates": context.dates, "currency": context.currency},
        "places_and_plans": [_spot_json(spot) for spot in context.spots],
    }
    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM + json.dumps(data, ensure_ascii=False, default=str),
        tools=_tools(context),
        temperature=0.2,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(maximum_remote_calls=8),
    )

    models = [settings.GEMINI_MODEL, *[m for m in settings.GEMINI_FALLBACK_MODELS if m != settings.GEMINI_MODEL]]
    for index, model in enumerate(models):
        try:
            # A chat, because the tool calls go back and forth before the answer
            response = client.chats.create(model=model, config=config).send_message(question)
            break
        except genai_errors.APIError as error:
            last = index == len(models) - 1
            if (error.code in RETRYABLE_CODES or error.code == 404) and not last:
                logger.warning("Gemini model %s returned %s, trying %s", model, error.code, models[index + 1])
                continue
            logger.exception("Gemini could not answer")
            if error.code in RETRYABLE_CODES:
                raise AssistantError("The AI service is busy right now. Try again in a minute.") from error
            raise AssistantError("The AI service couldn't answer that") from error
        except Exception as error:
            logger.exception("Gemini could not answer")
            raise AssistantError("The AI service couldn't answer that") from error

    text = (response.text or "").strip()
    if not text:
        raise AssistantError("The AI service couldn't answer that")
    return Answer(text=text, mentioned=mentioned_spots(text, context))
