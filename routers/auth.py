from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import connect_db
from models import User
from schemas import UserCreate, UserLogin, UserResponse, Token
from security import hash_password, verify_password, create_access_token
from validators import password_strength

router = APIRouter(
    prefix="/auth",
    tags=["Authentication"]
)

@router.post("/signup", response_model=UserResponse, status_code=201)
def signup(
    user: UserCreate,
    db: Session = Depends(connect_db)
):  
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invalid credentials"
        )
    if not user.name.isalnum():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid credentials"
        )
    email_prefix = user.email.split('@')[0]  # Extract the part before '@' for additional checks
    user_inputs = [user.username.lower(), email_prefix.lower()]
    result = password_strength(user.password.lower(), user_inputs)
    if not result["is_valid"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid credentials"
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

@router.post("/login", response_model=Token)
def login(
    user: UserLogin,
    db: Session = Depends(connect_db)
):
    user_detail = db.query(User).filter(User.email == user.email).first()
    if not user_detail:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Incorrect credentials"
        )
    if not verify_password(user_detail.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Incorrect credentials"
        )
    token = create_access_token({"sub": str(user_detail.id)})
    return {
        "access_token": token,
        "token_type": "access"
    }

