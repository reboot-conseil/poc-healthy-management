import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class Utterance(Base):
    """One diarized speaker turn within a session.

    Populated in two phases:
      Phase 1 (transcribe_node): speaker, start_time, end_time, text
      Phase 2 (analyze_node):    intention, sentiment, issues
    """

    __tablename__ = "utterances"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Single letter label returned by AssemblyAI after SPEAKER_ prefix is stripped
    speaker: Mapped[str] = mapped_column(Text, nullable=False)
    # Timestamps in seconds (AssemblyAI returns milliseconds — converted on ingest)
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Filled by analyze_node — NULL until LangGraph phase completes
    intention: Mapped[str | None] = mapped_column(Text, nullable=True)
    sentiment: Mapped[str | None] = mapped_column(Text, nullable=True)
    issues: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
