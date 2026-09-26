from pydantic import BaseModel, EmailStr, Field, HttpUrl, model_validator
from datetime import date, datetime
from typing import Literal

TripRole = Literal["owner", "member", "viewer"]
ExpenseCategory = Literal["accommodation", "transport", "food", "activities", "shopping", "other"]

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password:str

class UserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr

    model_config={
        "from_attributes": True
    }

class UserUpdate(BaseModel):
    name: str | None = None
    email: EmailStr | None = None
    password: str | None = None

class Token(BaseModel):
    access_token: str
    token_type: str

class GuestAccessCreate(BaseModel):
    access_code: str
    pin: str

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

class TripCreate(BaseModel):
    title: str
    description: str | None = None
    destination: str
    start_date: date
    end_date: date
    budget: float | None = Field(default=None, ge=0)
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

class TripUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    destination: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    budget: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)

class MemberResponse(BaseModel):
    user_id: int
    name: str
    email: EmailStr
    role: str

class MemberRoleUpdate(BaseModel):
    role: TripRole

class InvitationCreate(BaseModel):
    email: EmailStr

class InvitationResponse(BaseModel):
    id: int
    trip_id: int
    user_id: int
    invited_by_id: int | None = None
    status: str
    created_at: datetime

    model_config={
        "from_attributes": True
    }

class ActivityCreate(BaseModel):
    title: str
    description: str | None = None
    location: str
    start_time: datetime
    end_time: datetime
    estimated_cost: float | None = Field(default=None, ge=0)
    source_link_id: int | None = None

    @model_validator(mode="after")
    def validate_times(self):
        if self.end_time < self.start_time:
            raise ValueError("End time cannot be before start time")

        return self

class ActivityUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    location: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    estimated_cost: float | None = Field(default=None, ge=0)
    source_link_id: int | None = None

class ActivityResponse(BaseModel):
    id: int
    trip_id: int
    source_link_id: int | None = None
    title: str
    description: str | None = None
    location: str
    start_time: datetime
    end_time: datetime
    estimated_cost: float | None = None

    model_config={
        "from_attributes": True
    }

class ItineraryActivity(ActivityResponse):
    conflicts_with: list[int] = []

class ItineraryDay(BaseModel):
    date: date
    activities: list[ItineraryActivity]
    estimated_cost: float

class ItineraryResponse(BaseModel):
    trip_id: int
    days: list[ItineraryDay]
    conflict_count: int

class SavedLinkCreate(BaseModel):
    url: HttpUrl
    place_name: str | None = None
    notes: str | None = None

class SavedLinkUpdate(BaseModel):
    place_name: str | None = None
    notes: str | None = None

class SavedLinkResponse(BaseModel):
    id: int
    trip_id: int
    added_by_id: int | None = None
    url: str
    platform: str
    title: str | None = None
    author_name: str | None = None
    thumbnail_url: str | None = None
    place_name: str | None = None
    notes: str | None = None
    status: str
    created_at: datetime

    model_config={
        "from_attributes": True
    }

class LinkToActivity(BaseModel):
    title: str | None = None
    description: str | None = None
    location: str | None = None
    start_time: datetime
    end_time: datetime
    estimated_cost: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_times(self):
        if self.end_time < self.start_time:
            raise ValueError("End time cannot be before start time")

        return self

class ExpenseCreate(BaseModel):
    title: str
    amount: float = Field(gt=0)
    category: ExpenseCategory = "other"
    spent_on: date | None = None
    activity_id: int | None = None
    paid_by_id: int | None = None

class ExpenseUpdate(BaseModel):
    title: str | None = None
    amount: float | None = Field(default=None, gt=0)
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

class BudgetSummary(BaseModel):
    trip_id: int
    currency: str
    budget: float | None = None
    total_spent: float
    remaining: float | None = None
    planned_activity_cost: float
    by_category: dict[str, float]
    balances: list[MemberBalance]
