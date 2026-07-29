from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from models import User
from schemas import UserCreate, UserLogin, UserResponse
from security import hash_password, verify_password, create_access_token
from validators import password_strength

router = APIRouter(
    prefix="/auth",
    tags=["Authentication"]
)

@router.post("/signup", response_model=UserResponse)
def signup(
    user: UserCreate,
    db: Session = Depends(connect_db)
):  
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    else:
        email_prefix = user.email.split('@')[0]  # Extract the part before '@' for additional checks
        user_inputs = [user.username.lower(), email_prefix.lower()]
        result = password_strength(user.password.lower(), user_inputs)
        if not result["is_valid"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Password is not secure: {result['error']}"
            )

        hashed_password = hash_password(user.password)
        new_user = User(
            name=user.username,
            email=user.email,
            password=hashed_password
        )

        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        return new_user