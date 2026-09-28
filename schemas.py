from pydantic import AfterValidator, BaseModel, EmailStr, Field, HttpUrl, StringConstraints, field_validator, model_validator
from datetime import date, datetime
from typing import Annotated, Literal

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
    # A new address waiting to be confirmed from its inbox
    pending_email: str | None = None

    model_config={
        "from_attributes": True
    }

class UserPublic(BaseModel):
    # What other users can see, so emails aren't exposed through search
    id: int
    name: str
    avatar_url: str | None = None

    model_config={
        "from_attributes": True
    }

class UserUpdate(BaseModel):
    name: ShortText | None = None
    email: Email | None = None
    password: Password | None = None
    avatar_url: HttpUrl | None = None
    # Needed to change the email or password, so a stolen session can't take over the account
    current_password: str | None = Field(default=None, max_length=128)

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
    pin: str = Field(min_length=4, max_length=12, pattern=r"^\d+$")
    expires_at: datetime | None = None

class GuestAccessResponse(BaseModel):
    trip_id: int
    access_code: str
    expires_at: datetime | None = None

    model_config={
        "from_attributes": True
    }

class CurrencySuggestion(BaseModel):
    # None when the destination couldn't be placed in a country
    currency: str | None

class TripCreate(BaseModel):
    title: ShortText
    description: LongText | None = None
    destination: ShortText
    start_date: date
    end_date: date
    budget: float | None = Field(default=None, ge=0, le=9_999_999_999)
    currency: str = Field(default="USD", min_length=3, max_length=3)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("End date cannot be before start date")

        return self

class TripResponse(BaseModel):
    id: int
    title: str
    description: str | None = None
    destination: str
    start_date: date | None = None
    end_date: date | None = None
    budget: float | None = None
    currency: str

    model_config={
        "from_attributes": True
    }

class TripMemberPreview(BaseModel):
    user_id: int
    name: str
    avatar_url: str | None = None

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
    destination: ShortText | None = None
    start_date: date | None = None
    end_date: date | None = None
    budget: float | None = Field(default=None, ge=0, le=9_999_999_999)
    currency: str | None = Field(default=None, min_length=3, max_length=3)

class MemberResponse(BaseModel):
    user_id: int
    name: str
    email: EmailStr
    role: str
    avatar_url: str | None = None

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

class ScheduleWarning(BaseModel):
    # closed: the place is shut that day; outside_hours: open that day, but not at this time;
    # tight_travel: not enough time to get here from the plan before
    kind: Literal["closed", "outside_hours", "tight_travel"]
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

class SavedLinkCreate(BaseModel):
    url: HttpUrl
    place_name: ShortText | None = None
    notes: LongText | None = None

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

class ExpenseCreate(BaseModel):
    title: ShortText
    amount: float = Field(gt=0, le=99_999_999)
    category: ExpenseCategory = "other"
    spent_on: date | None = None
    activity_id: int | None = None
    paid_by_id: int | None = None

class ExpenseUpdate(BaseModel):
    title: ShortText | None = None
    amount: float | None = Field(default=None, gt=0, le=99_999_999)
    category: ExpenseCategory | None = None
    spent_on: date | None = None
    activity_id: int | None = None
    paid_by_id: int | None = None

class ExpenseResponse(BaseModel):
    id: int
    trip_id: int
    paid_by_id: int | None = None
    activity_id: int | None = None
    title: str
    amount: float
    category: str
    spent_on: date | None = None
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
    total: float

class BudgetEstimate(BaseModel):
    """Roughly what the whole trip will cost the group, day by day."""
    currency: str
    people: int
    days: list[BudgetEstimateDay]
    plans_total: float
    meals_total: float
    transport_total: float
    total: float
    budget: float | None = None
    # Positive when the estimate is over the budget
    over_budget_by: float | None = None
    # Plans with no cost and no way to guess one
    unpriced_plans: int
    notes: list[str]

class BudgetSummary(BaseModel):
    trip_id: int
    currency: str
    budget: float | None = None
    total_spent: float
    remaining: float | None = None
    planned_activity_cost: float
    by_category: dict[str, float]
    balances: list[MemberBalance]
