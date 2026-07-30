from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from models import User
from schemas import UserCreate, UserLogin, UserResponse
from security import hash_password, verify_password, create_access_token
from validators import password_strength
from dependencies import get_current_user

router = APIRouter(
    prefix="/users",
    tags=["User Data"]
)

@router.get("/me", response_model=UserResponse)
def get_me(
    current_user: User = Depends(get_current_user)
):
    return current_user