from pydantic import AfterValidator, BaseModel, EmailStr, Field, HttpUrl, StringConstraints, field_validator, model_validator
from datetime import date, datetime
from typing import Annotated, Literal

import appearance
from link_parser import UNSUPPORTED_LINK, supported_link

# Emails are stored and compared lowercased, so Sam@Example.com and sam@example.com are one account
Email = Annotated[EmailStr, AfterValidator(str.lower)]
# Limits that match the database columns, so long input gets a clear 422 instead of a server error
ShortText = Annotated[str, StringConstraints(max_length=255)]
LongText = Annotated[str, StringConstraints(max_length=5000)]
Password = Annotated[str, StringConstraints(max_length=128)]
OpaqueToken = Annotated[str, StringConstraints(max_length=256)]
# Money columns hold up to 99,999,999.99 (plans and expenses) or 9,999,999,999.99 (budgets)
Amount = Annotated[float, Field(ge=0, le=99_999_999)]

TripRole = Literal["owner", "member", "viewer"]
AvatarBuddy = Literal[appearance.AVATAR_BUDDIES]
ExpenseCategory = Literal["accommodation", "transport", "food", "activities", "shopping", "other"]

class UserCreate(BaseModel):
    name: ShortText
    email: Email
    password: Password

class UserLogin(BaseModel):
    email: Email
    password: Password

class UserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    avatar_url: str | None = None
    # Shown when there's no photo
    avatar_buddy: str | None = None
    # A new address waiting to be confirmed from its inbox
    pending_email: str | None = None
    # False until someone who signed up with Google or Apple sets a password
    has_password: bool = True

    model_config={
        "from_attributes": True
    }

class UserPublic(BaseModel):
    # What other users can see, so emails aren't exposed through search
    id: int
    name: str
    avatar_url: str | None = None
    avatar_buddy: str | None = None

    model_config={
        "from_attributes": True
    }

class UserUpdate(BaseModel):
    name: ShortText | None = None
    email: Email | None = None
    password: Password | None = None
    # A buddy to show instead of initials when there's no photo; null for initials
    avatar_buddy: AvatarBuddy | None = None
    # No avatar_url: a photo is uploaded (PUT /users/me/avatar), never a link to another site,
    # which could log the address of everyone whose app shows it
    # Needed to change the email or password, so a stolen session can't take over the account
    current_password: str | None = Field(default=None, max_length=128)

class PasswordSet(BaseModel):
    # The emailed six-digit code (see EmailCode below)
    code: Annotated[str, StringConstraints(max_length=12)]
    password: Password

class AccountDelete(BaseModel):
    password: str = Field(max_length=128)

class Token(BaseModel):
    access_token: str
    token_type: str
    # Guests only get a short lived access token
    refresh_token: str | None = None

class RefreshRequest(BaseModel):
    # Left out by the website, whose refresh token is in a cookie instead
    refresh_token: OpaqueToken | None = None

class PasswordResetRequest(BaseModel):
    email: Email

# A six-digit code from an email; a little longer allowed so pasted spaces or dashes still fit
EmailCode = Annotated[str, StringConstraints(max_length=12)]

class PasswordResetConfirm(BaseModel):
    # The emailed code with its email address, or (from before codes) the link's token
    email: Email | None = None
    code: EmailCode | None = None
    token: OpaqueToken | None = None
    new_password: Password

    @model_validator(mode="after")
    def code_or_link(self):
        if self.token is None and (self.email is None or self.code is None):
            raise ValueError("Send the email and code from the reset email")
        return self

class VerifyCodeRequest(BaseModel):
    # From the sign-up response: the code only finishes the sign-up it was emailed for
    signup_token: OpaqueToken
    code: EmailCode

class SignInOptions(BaseModel):
    # The Google client the website's sign-in button uses, or None when Google sign-in is off
    google_client_id: str | None = None

class SocialLoginRequest(BaseModel):
    provider: Literal["google", "apple"]
    # The ID token Google or Apple gave the app (a signed JWT, usually 1-2 KB)
    id_token: Annotated[str, StringConstraints(max_length=8192)]
    # Apple only: the random value whose hash the app gave Apple for this sign-in
    nonce: Annotated[str, StringConstraints(max_length=256)] | None = None
    # Apple only tells the app someone's name the first time, and never puts it in the token
    name: ShortText | None = None

class CodeRequest(BaseModel):
    code: EmailCode

class MessageResponse(BaseModel):
    detail: str

class VerifyEmailRequest(BaseModel):
    token: OpaqueToken

class ResendVerificationRequest(BaseModel):
    signup_token: OpaqueToken

class SignupResponse(BaseModel):
    detail: str
    # Sent back with the emailed code. Every sign-up gets one, even for a taken email, so the
    # answer doesn't reveal who has an account; those tokens just never match a code.
    signup_token: str

class GuestAccessCreate(BaseModel):
    access_code: Annotated[str, StringConstraints(max_length=16)]
    pin: Annotated[str, StringConstraints(max_length=12)]

class GuestAccessSetup(BaseModel):
    # Letters and numbers, and capitals matter. Six or more, so guessing is hopeless within the
    # code's lifetime of wrong tries (see GUEST_LOCK_AFTER)
    pin: str = Field(pattern=r"^[A-Za-z0-9]{6,12}$")
    expires_at: datetime | None = None
    show_costs: bool = False
    allow_edits: bool = False

class GuestAccessUpdate(BaseModel):
    # Left out, a setting stays as it is
    show_costs: bool | None = None
    allow_edits: bool | None = None

class GuestAccessResponse(BaseModel):
    trip_id: int
    access_code: str
    expires_at: datetime | None = None
    show_costs: bool = False
    allow_edits: bool = False
    # The website address that asks for this code's PIN, for sharing
    url: str
    # Too many wrong PINs were tried, so the code no longer works; a new code and PIN fixes it
    locked: bool = False

class GuestToken(Token):
    access_code: str
    show_costs: bool
    allow_edits: bool

class GuestLookup(BaseModel):
    """What a code's link page shows before the PIN is asked for: the title only."""
    title: str
    # Only for someone signed in who is on the trip, so their page can open it instead of asking for the PIN
    trip_id: int | None = None

class CurrencySuggestion(BaseModel):
    # None when the destination couldn't be placed in a country
    currency: str | None

class Destination(BaseModel):
    """One place a trip goes. A pin and country are filled in by the server when it can."""
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    # e.g. "Kyoto Prefecture, Japan", to tell apart places with the same name
    address: ShortText | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)

class DestinationSuggestion(Destination):
    # The currency used there, e.g. JPY for Kyoto
    currency: str | None = None

# Up to this many places in one trip
MAX_DESTINATIONS = 10

class TripCreate(BaseModel):
    title: ShortText
    description: LongText | None = None
    # Either the places, or (from older apps) just a name
    destination: ShortText | None = None
    destinations: list[Destination] = Field(default=[], max_length=MAX_DESTINATIONS)
    start_date: date
    end_date: date
    budget: float | None = Field(default=None, ge=0, le=9_999_999_999)
    currency: str = Field(default="USD", min_length=3, max_length=3)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("End date cannot be before start date")
        if not self.destinations and not (self.destination or "").strip():
            raise ValueError("Add where the trip goes")

        return self

class TripBuddies(BaseModel):
    """The buddy for each style that has them; null for none."""
    pixel: Literal[appearance.CASTS["pixel"]] | None = appearance.DEFAULT_BUDDIES["pixel"]
    poster: Literal[appearance.CASTS["poster"]] | None = appearance.DEFAULT_BUDDIES["poster"]
    postcard: Literal[appearance.CASTS["postcard"]] | None = appearance.DEFAULT_BUDDIES["postcard"]
    stickers: Literal[appearance.CASTS["stickers"]] | None = appearance.DEFAULT_BUDDIES["stickers"]

    model_config={"extra": "forbid"}

class TripAppearance(BaseModel):
    """How the trip looks (see appearance.py). Choices for other styles are kept, so switching
    back to a style brings back what was picked for it."""
    style: Literal[appearance.STYLES] = "pixel"
    colour: Literal[appearance.COLOURS] = "harbour"
    scene: Literal[appearance.SCENES] = "city"
    buddies: TripBuddies = TripBuddies()
    pattern: Literal[appearance.PATTERNS] = "dots"
    emoji: Literal[appearance.EMOJI] = appearance.EMOJI[0]

    model_config={"extra": "forbid"}

class TripResponse(BaseModel):
    id: int
    title: str
    description: str | None = None
    destination: str
    destinations: list[Destination] = []
    start_date: date | None = None
    end_date: date | None = None
    budget: float | None = None
    currency: str
    appearance: TripAppearance = TripAppearance()
    # The photo for the "photo" style, once one is uploaded
    cover_url: str | None = None

    model_config={
        "from_attributes": True
    }

class TripMemberPreview(BaseModel):
    user_id: int
    name: str
    avatar_url: str | None = None
    avatar_buddy: str | None = None

class TripSummaryResponse(TripResponse):
    """A trip in the trips list, with enough to show what's in it."""
    plan_count: int = 0
    saved_count: int = 0
    spent: float = 0
    member_count: int = 0
    # The first few people, for avatars
    members: list[TripMemberPreview] = []

class TripUpdate(BaseModel):
    title: ShortText | None = None
    description: LongText | None = None
    # Setting `destination` alone replaces the places with that one name
    destination: ShortText | None = None
    destinations: list[Destination] | None = Field(default=None, min_length=1, max_length=MAX_DESTINATIONS)
    start_date: date | None = None
    end_date: date | None = None
    budget: float | None = Field(default=None, ge=0, le=9_999_999_999)
    currency: str | None = Field(default=None, min_length=3, max_length=3)

class CurrencyChange(BaseModel):
    currency: str = Field(pattern=r"^[A-Za-z]{3}$")

class CurrencyChangeResponse(BaseModel):
    trip: TripResponse
    # 1 unit of `old_currency` is this many units of the trip's new currency
    rate: float
    old_currency: str

class MemberResponse(BaseModel):
    user_id: int
    name: str
    email: EmailStr
    role: str
    avatar_url: str | None = None
    avatar_buddy: str | None = None

class MemberRoleUpdate(BaseModel):
    role: TripRole

class InvitationCreate(BaseModel):
    email: Email | None = None
    user_id: int | None = None

    @model_validator(mode="after")
    def validate_invitee(self):
        if (self.email is None) == (self.user_id is None):
            raise ValueError("Provide either email or user_id")

        return self

class InvitationResponse(BaseModel):
    id: int
    trip_id: int
    # Empty for an invite to an email that isn't on Triplet yet
    user_id: int | None = None
    invited_by_id: int | None = None
    status: str
    created_at: datetime
    trip_title: str
    trip_destination: str
    trip_start_date: date | None = None
    trip_end_date: date | None = None
    # Only filled in once they've joined, so invites don't reveal who has an account
    invitee_name: str | None = None
    invitee_email: EmailStr
    invited_by_name: str | None = None

    model_config={
        "from_attributes": True
    }

Latitude = Field(default=None, ge=-90, le=90)
Longitude = Field(default=None, ge=-180, le=180)

def validate_coordinates(model):
    # A pin needs both halves, or neither
    if (model.latitude is None) != (model.longitude is None):
        raise ValueError("Latitude and longitude must be set together")
    return model

class ActivityCreate(BaseModel):
    title: ShortText
    description: LongText | None = None
    location: ShortText
    start_time: datetime
    end_time: datetime
    estimated_cost: Amount | None = None
    source_link_id: int | None = None
    latitude: float | None = Latitude
    longitude: float | None = Longitude

    @model_validator(mode="after")
    def validate_times(self):
        if self.end_time < self.start_time:
            raise ValueError("End time cannot be before start time")

        return validate_coordinates(self)

class ActivityUpdate(BaseModel):
    title: ShortText | None = None
    description: LongText | None = None
    location: ShortText | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    estimated_cost: Amount | None = None
    source_link_id: int | None = None
    latitude: float | None = Latitude
    longitude: float | None = Longitude

    @model_validator(mode="after")
    def validate_pin(self):
        if "latitude" in self.model_fields_set or "longitude" in self.model_fields_set:
            return validate_coordinates(self)
        return self

class ActivityResponse(BaseModel):
    id: int
    trip_id: int
    source_link_id: int | None = None
    place_id: int | None = None
    title: str
    description: str | None = None
    location: str
    latitude: float | None = None
    longitude: float | None = None
    start_time: datetime
    end_time: datetime
    estimated_cost: float | None = None

    model_config={
        "from_attributes": True
    }

StayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
StayAddress = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
Confirmation = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]

class StayCreate(BaseModel):
    name: StayName
    address: StayAddress | None = None
    latitude: float | None = Latitude
    longitude: float | None = Longitude
    check_in: date
    check_out: date
    # For the whole stay, in the trip's currency
    cost: Amount | None = None
    confirmation: Confirmation | None = None
    # A saved place it's made from, e.g. a hotel from a TikTok
    place_id: int | None = None

    @model_validator(mode="after")
    def validate_stay(self):
        if self.check_out <= self.check_in:
            raise ValueError("Check-out must be after check-in")
        return validate_coordinates(self)

class StayUpdate(BaseModel):
    name: StayName | None = None
    address: StayAddress | None = None
    latitude: float | None = Latitude
    longitude: float | None = Longitude
    check_in: date | None = None
    check_out: date | None = None
    cost: Amount | None = None
    confirmation: Confirmation | None = None

    @model_validator(mode="after")
    def validate_pin(self):
        if "latitude" in self.model_fields_set or "longitude" in self.model_fields_set:
            return validate_coordinates(self)
        return self

class StayResponse(BaseModel):
    id: int
    trip_id: int
    place_id: int | None = None
    name: str
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    check_in: date
    check_out: date
    cost: float | None = None
    confirmation: str | None = None

    model_config={
        "from_attributes": True
    }

class StayDraft(BaseModel):
    """What a booking confirmation says, for the app to fill the stay form with. Nothing is saved."""
    name: str | None = None
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    check_in: date | None = None
    check_out: date | None = None
    # In the trip's currency
    cost: float | None = None
    confirmation: str | None = None
    # Things to check before saving, e.g. "The dates are outside the trip"
    notes: list[str] = []

class StayStop(BaseModel):
    """Where a day starts or ends, as the plan shows it. No price or booking reference, since guests see it too."""
    id: int
    name: str
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None

AirportName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
AirportCode = Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z]{3,4}$")]
FlightNumber = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]
Airline = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]

def validate_airport_pins(model):
    for side in ("from", "to"):
        lat, lon = f"{side}_latitude", f"{side}_longitude"
        if (lat in model.model_fields_set or lon in model.model_fields_set) and (getattr(model, lat) is None) != (getattr(model, lon) is None):
            raise ValueError("Latitude and longitude must be set together")
    return model

class FlightCreate(BaseModel):
    flight_number: FlightNumber | None = None
    airline: Airline | None = None
    from_name: AirportName
    from_code: AirportCode | None = None
    from_latitude: float | None = Latitude
    from_longitude: float | None = Longitude
    to_name: AirportName
    to_code: AirportCode | None = None
    to_latitude: float | None = Latitude
    to_longitude: float | None = Longitude
    # Each airport's local time, like plan times: "2026-10-10T07:15:00Z" is 07:15 on the ticket.
    # Arriving "before" leaving is fine, e.g. flying east over the date line.
    departs_at: datetime
    arrives_at: datetime
    cost: Amount | None = None
    confirmation: Confirmation | None = None

    @model_validator(mode="after")
    def validate_pins(self):
        return validate_airport_pins(self)

class FlightUpdate(BaseModel):
    flight_number: FlightNumber | None = None
    airline: Airline | None = None
    from_name: AirportName | None = None
    from_code: AirportCode | None = None
    from_latitude: float | None = Latitude
    from_longitude: float | None = Longitude
    to_name: AirportName | None = None
    to_code: AirportCode | None = None
    to_latitude: float | None = Latitude
    to_longitude: float | None = Longitude
    departs_at: datetime | None = None
    arrives_at: datetime | None = None
    cost: Amount | None = None
    confirmation: Confirmation | None = None

    @model_validator(mode="after")
    def validate_pins(self):
        return validate_airport_pins(self)

class FlightResponse(BaseModel):
    id: int
    trip_id: int
    flight_number: str | None = None
    airline: str | None = None
    from_name: str
    from_code: str | None = None
    from_latitude: float | None = None
    from_longitude: float | None = None
    to_name: str
    to_code: str | None = None
    to_latitude: float | None = None
    to_longitude: float | None = None
    departs_at: datetime
    arrives_at: datetime
    cost: float | None = None
    confirmation: str | None = None

    model_config={
        "from_attributes": True
    }

class AirportResult(BaseModel):
    code: str
    name: str
    city: str
    # Two letters, e.g. "JP"
    country: str
    latitude: float
    longitude: float

class FlightDraft(BaseModel):
    """One flight an e-ticket shows, for the app to fill the flight form with."""
    flight_number: str | None = None
    airline: str | None = None
    from_name: str | None = None
    from_code: str | None = None
    from_latitude: float | None = None
    from_longitude: float | None = None
    to_name: str | None = None
    to_code: str | None = None
    to_latitude: float | None = None
    to_longitude: float | None = None
    departs_at: datetime | None = None
    arrives_at: datetime | None = None
    # In the trip's currency
    cost: float | None = None
    confirmation: str | None = None

class FlightDrafts(BaseModel):
    """Every flight on an e-ticket, e.g. there and back. Nothing is saved."""
    flights: list[FlightDraft]
    # Things to check before saving, e.g. a converted price
    notes: list[str] = []

class ScheduleWarning(BaseModel):
    # closed: the place is shut that day; outside_hours: open that day, but not at this time;
    # tight_travel: not enough time to get here from the plan before; flight: it clashes with a flight
    kind: Literal["closed", "outside_hours", "tight_travel", "flight"]
    message: str

class TravelLeg(BaseModel):
    """Rough travel from the plan before, from the distance and the time of day."""
    minutes: int
    mode: Literal["walk", "transit"]
    km: float
    # Why it takes longer than usual, e.g. "rush hour" or "late at night, likely a taxi"
    note: str | None = None
    # When to leave the plan before to arrive on time; unset when there isn't enough time
    leave_by: datetime | None = None

class ItineraryFlight(BaseModel):
    """
    A flight as one day's plan shows it: taking off that day, or landing. No price or booking
    reference, since guests see it too.
    """
    flight_id: int
    kind: Literal["departure", "arrival"]
    flight_number: str | None = None
    airline: str | None = None
    # The airport this end of the flight is at, and the other end's name
    airport: str
    airport_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    other_airport: str
    other_airport_code: str | None = None
    # Take-off or landing, on the airport's clock
    time: datetime
    # Leaving: when to be at the airport. Landing: roughly when you're out of it.
    ready_at: datetime
    # Leaving: getting to the airport from the plan or hotel before
    travel_from_previous: "TravelLeg | None" = None
    warnings: list["ScheduleWarning"] = []

class ItineraryActivity(ActivityResponse):
    conflicts_with: list[int] = []
    # Where the plan's saved post came from, e.g. "tiktok", "youtube", "instagram"
    source_platform: str | None = None
    warnings: list[ScheduleWarning] = []
    travel_from_previous: TravelLeg | None = None

class DayWeather(BaseModel):
    summary: str
    high: float | None = None
    low: float | None = None
    rain_chance: int | None = None

class ItineraryDay(BaseModel):
    date: date
    activities: list[ItineraryActivity]
    estimated_cost: float
    # Only for days within the next two weeks, where a plan has a map pin
    weather: DayWeather | None = None
    # Where the day starts (last night's stay) and ends (tonight's); different on a day you move hotels
    start_stay: StayStop | None = None
    end_stay: StayStop | None = None
    # From the day's last plan back to tonight's stay
    travel_to_stay: TravelLeg | None = None
    # Flights leaving or landing that day, in time order
    flights: list[ItineraryFlight] = []

class PlanDraftItem(BaseModel):
    place_id: int
    name: str
    start_time: datetime
    end_time: datetime
    # Everyone who saved this place, across all their posts
    saved_by: list[str]
    # Other people's copies of the same place, merged into this one
    merged_place_ids: list[int]
    reason: str

class PlanDraftSkipped(BaseModel):
    place_id: int
    name: str
    reason: str

class PlanDraftResponse(BaseModel):
    items: list[PlanDraftItem]
    skipped: list[PlanDraftSkipped]
    merged_count: int

class PlanDraftApplyItem(BaseModel):
    place_id: int
    start_time: datetime
    end_time: datetime

    @model_validator(mode="after")
    def validate_times(self):
        if self.end_time < self.start_time:
            raise ValueError("End time cannot be before start time")
        return self

class PlanDraftApply(BaseModel):
    items: list[PlanDraftApplyItem] = Field(min_length=1, max_length=100)

class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)

class AskMention(BaseModel):
    kind: Literal["place", "plan"]
    id: int
    name: str

class AskResponse(BaseModel):
    answer: str
    # Places and plans the answer names, for the app to link
    mentions: list[AskMention]

class SlotSuggestion(BaseModel):
    start_time: datetime
    end_time: datetime
    reason: str

class ItineraryResponse(BaseModel):
    trip_id: int
    days: list[ItineraryDay]
    conflict_count: int

class GuestItineraryDay(ItineraryDay):
    # Left out unless the owner shows costs to guests
    estimated_cost: float | None = None

class GuestItineraryResponse(BaseModel):
    trip_id: int
    days: list[GuestItineraryDay]
    conflict_count: int
    # Whether the owner currently lets guests add and change plans
    allow_edits: bool = False
    show_costs: bool = False

class SavedLinkCreate(BaseModel):
    url: HttpUrl
    place_name: ShortText | None = None
    notes: LongText | None = None

    @field_validator("url")
    @classmethod
    def only_video_posts(cls, url: HttpUrl) -> HttpUrl:
        if not supported_link(str(url)):
            raise ValueError(UNSUPPORTED_LINK)
        return url

class SavedLinkUpdate(BaseModel):
    place_name: ShortText | None = None
    notes: LongText | None = None
    # Renames the post; empty or null goes back to the post's own title
    custom_title: str | None = Field(default=None, max_length=255)

    @field_validator("custom_title")
    @classmethod
    def blank_title_is_none(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

PlaceCategory = Literal["food", "cafe", "bar", "nightlife", "attraction", "nature", "shopping", "accommodation", "activity", "other"]

class ExtractedPlaceResponse(BaseModel):
    id: int
    link_id: int
    name: str
    category: str | None = None
    address: str | None = None
    city: str | None = None
    country: str | None = None
    price_range: str | None = None
    notes: str | None = None
    hours_from_post: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    opening_hours: list[str] | None = None
    website: str | None = None
    phone: str | None = None
    details_status: str
    # "osm" or "google". OpenStreetMap's licence requires showing "© OpenStreetMap contributors"
    details_source: str | None = None
    needs_review: bool
    user_edited: bool

    model_config={
        "from_attributes": True
    }

class TripPlaceResponse(ExtractedPlaceResponse):
    # Activities planned from this place, empty when it's only saved
    activity_ids: list[int] = []

class PlaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    category: PlaceCategory | None = None
    address: str | None = Field(default=None, max_length=500)
    city: str | None = Field(default=None, max_length=255)
    country: str | None = Field(default=None, max_length=255)
    price_range: str | None = Field(default=None, max_length=50)
    notes: LongText | None = None
    latitude: float | None = Latitude
    longitude: float | None = Longitude
    # Seven entries, Monday first, e.g. "11:00 – 15:00" or "Closed"
    opening_hours: list[str] | None = Field(default=None, min_length=7, max_length=7)
    website: HttpUrl | None = None
    phone: str | None = Field(default=None, max_length=50)
    # Set when the user picked a search result in the pin picker
    google_place_id: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def validate_pin(self):
        if "latitude" in self.model_fields_set or "longitude" in self.model_fields_set:
            return validate_coordinates(self)
        return self

class PlaceSearchResult(BaseModel):
    # Only set for Google results
    google_place_id: str | None = None
    name: str
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None

class SavedLinkResponse(BaseModel):
    id: int
    trip_id: int
    added_by_id: int | None = None
    url: str
    platform: str
    title: str | None = None
    custom_title: str | None = None
    author_name: str | None = None
    thumbnail_url: str | None = None
    place_name: str | None = None
    notes: str | None = None
    caption: str | None = None
    summary: str | None = None
    status: str
    error: str | None = None
    processed_at: datetime | None = None
    places: list[ExtractedPlaceResponse] = []
    created_at: datetime

    model_config={
        "from_attributes": True
    }

class LinkToActivity(BaseModel):
    # Fill in the title and location from one of the places found in the video
    place_id: int | None = None
    title: ShortText | None = None
    description: LongText | None = None
    location: ShortText | None = None
    start_time: datetime
    end_time: datetime
    estimated_cost: Amount | None = None

    @model_validator(mode="after")
    def validate_times(self):
        if self.end_time < self.start_time:
            raise ValueError("End time cannot be before start time")

        return self

ExpenseSplit = Literal["all", "people", "amounts"]

class ExpenseShareIn(BaseModel):
    user_id: int
    # With split "people", left out to share what's left evenly; with "amounts", required
    amount: float | None = Field(default=None, ge=0, le=99_999_999)

class ExpenseShareOut(BaseModel):
    user_id: int
    amount: float
    # Typed in, rather than an even part of what's left
    fixed: bool = False

    model_config = {"from_attributes": True}

class ExpensePaymentIn(BaseModel):
    user_id: int
    amount: float = Field(gt=0, le=99_999_999)

class ExpensePaymentOut(BaseModel):
    user_id: int
    amount: float

    model_config = {"from_attributes": True}

class ExpenseCreate(BaseModel):
    title: ShortText
    amount: float = Field(gt=0, le=99_999_999)
    category: ExpenseCategory = "other"
    spent_on: date | None = None
    activity_id: int | None = None
    paid_by_id: int | None = None
    # When several people paid, what each paid; it must add up to the amount. Leave it empty when
    # one person (paid_by_id) paid it all.
    payments: list[ExpensePaymentIn] = Field(default=[], max_length=50)
    # "all": everyone on the trip. "people": the people in shares; those given an amount pay that,
    # and the rest share what's left evenly. "amounts": shares' amounts (kept for older apps).
    split: ExpenseSplit = "all"
    shares: list[ExpenseShareIn] = Field(default=[], max_length=50)

class ExpenseUpdate(BaseModel):
    title: ShortText | None = None
    amount: float | None = Field(default=None, gt=0, le=99_999_999)
    category: ExpenseCategory | None = None
    spent_on: date | None = None
    activity_id: int | None = None
    paid_by_id: int | None = None
    # An empty list goes back to one person paying it all
    payments: list[ExpensePaymentIn] | None = Field(default=None, max_length=50)
    split: ExpenseSplit | None = None
    shares: list[ExpenseShareIn] | None = Field(default=None, max_length=50)

class ExpenseResponse(BaseModel):
    id: int
    trip_id: int
    paid_by_id: int | None = None
    activity_id: int | None = None
    title: str
    amount: float
    category: str
    spent_on: date | None = None
    split: str = "all"
    shares: list[ExpenseShareOut] = []
    # Empty when one person (paid_by_id) paid it all; otherwise who paid what, and paid_by_id is
    # whoever paid the most
    payments: list[ExpensePaymentOut] = []
    created_at: datetime

    model_config={
        "from_attributes": True
    }

class MemberBalance(BaseModel):
    user_id: int
    name: str
    paid: float
    share: float
    balance: float

class BudgetEstimateDay(BaseModel):
    date: date
    plans: float
    meals: float
    transport: float
    # That night's share of the stay's price
    stays: float = 0
    # Flights leaving that day
    flights: float = 0
    total: float

class BudgetEstimate(BaseModel):
    """Roughly what the whole trip will cost the group, day by day."""
    currency: str
    people: int
    days: list[BudgetEstimateDay]
    plans_total: float
    meals_total: float
    transport_total: float
    stays_total: float = 0
    flights_total: float = 0
    total: float
    budget: float | None = None
    # Positive when the estimate is over the budget
    over_budget_by: float | None = None
    # Plans with no cost and no way to guess one
    unpriced_plans: int
    notes: list[str]
    # The exchange rate service used to convert typical prices ("ExchangeRate-API" asks for a credit)
    rates_source: str | None = None

class SettlementCreate(BaseModel):
    from_user_id: int
    to_user_id: int
    amount: float = Field(gt=0, le=99_999_999)

class SettlementResponse(BaseModel):
    id: int
    from_user_id: int | None = None
    to_user_id: int | None = None
    amount: float
    created_at: datetime

    model_config = {"from_attributes": True}

class Transfer(BaseModel):
    """A payment that would even things out: from_user pays to_user."""
    from_user_id: int
    from_name: str
    to_user_id: int
    to_name: str
    amount: float

class BudgetSummary(BaseModel):
    trip_id: int
    currency: str
    budget: float | None = None
    total_spent: float
    remaining: float | None = None
    planned_activity_cost: float
    by_category: dict[str, float]
    balances: list[MemberBalance]
    # The fewest payments that would settle everyone up, after the paybacks already recorded
    settle_up: list[Transfer] = []
    settlements: list[SettlementResponse] = []
