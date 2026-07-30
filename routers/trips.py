from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from models import User
from schemas import UserCreate, UserLogin, UserResponse
from security import hash_password, verify_password, create_access_token
from validators import password_strength

router = APIRouter(
    prefix="/trips",
    tags=["Trips"]
)