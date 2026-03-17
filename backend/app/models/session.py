import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class SessionStatus(StrEnum):
    """Allowed session status values and their transitions.

    recording → processing → done
                           → error
    """

    RECORDING  = "recording"
    PROCESSING = "processing"
    DONE       = "done"
    ERROR      = "error"


class Session(Base):
    """Recording session — one row per workathon audio capture."""

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=SessionStatus.RECORDING,
    )
    # Filesystem path to the saved audio file (set after upload)
    audio_path: Mapped[str | None] = mapped_column(Text, nullable=True)
