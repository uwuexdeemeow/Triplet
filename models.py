from sqlalchemy import String, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] mapped_column(
        primary_key=True,
    )

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False
    )

    passsword: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )