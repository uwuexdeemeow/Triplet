from pydantic import BaseModel, EmailStr

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

class TripCreate(BaseModel):
    title: str
    description: str | None = None
    destination: str
    start_date: date | None = None
    end_date: date | None = None

class TripResponse(BaseModel):
    id: int
    title: str
    description: str | None = None
    destination: str
    start_date: date | None = None
    end_date: date | None = None

    model_config={
        "from_attributes": True
    }
    
    