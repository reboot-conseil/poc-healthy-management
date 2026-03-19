"""Session management endpoints.

Endpoints:
    POST   /sessions              Create a new recording session
    GET    /sessions/{id}         Poll session status
    POST   /sessions/{id}/audio   Upload full audio file, start pipeline

The audio upload endpoint returns 202 immediately and hands off to
run_pipeline() as a FastAPI BackgroundTask — the full pipeline (AssemblyAI
transcription + LangGraph LLM analysis loop + report generation) takes
1–5 minutes and must never block a worker.
"""

import asyncio
import logging
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.database import AsyncSessionLocal, get_db
from app.models.report import Report
from app.models.session import Session, SessionStatus
from app.models.utterance import Utterance
from app.pipeline.graph import PipelineState, pipeline_graph
from app.pipeline.transcription import TranscriptionError

router = APIRouter(prefix="/sessions", tags=["sessions"])
logger = logging.getLogger(__name__)


# ── Pydantic schemas ──────────────────────────────────────────────────────────


class SessionCreate(BaseModel):
    title: str | None = None


class SessionResponse(BaseModel):
    id: uuid.UUID
    status: str
    title: str | None = None
    audio_path: str | None = None

    model_config = {"from_attributes": True}


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("", status_code=201, response_model=SessionResponse)
async def create_session(
    body: SessionCreate,
    db: AsyncSession = Depends(get_db),
) -> Session:
    """Create a new recording session and return its ID.

    The frontend calls this before starting the microphone capture so it has
    a session_id to attach the audio file to at the end of the session.
    """
    session = Session(title=body.title)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: uuid.UUID,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> Session:
    """Return session metadata and current status.

    Returns HTTP 202 while status == 'processing' so the frontend polling
    loop can distinguish "still running" from "finished" without parsing JSON.
    """
    session = await db.get(Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.status == SessionStatus.PROCESSING:
        response.status_code = 202

    return session


@router.post("/{session_id}/audio", status_code=202)
async def upload_audio(
    session_id: uuid.UUID,
    file: UploadFile,
    background_tasks: BackgroundTasks,
    speakers_expected: int | None = None,
    language_code: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Upload the complete audio file and start the transcription pipeline.

    Streams the file to disk in 1 MB chunks, then immediately returns 202 Accepted. The pipeline runs
    asynchronously in the background.

    The session must be in 'recording' status — re-uploading is not allowed
    once processing has started.
    """
    session = await db.get(Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != SessionStatus.RECORDING:
        raise HTTPException(
            status_code=409,
            detail=f"Session status is '{session.status}', expected '{SessionStatus.RECORDING}'",
        )

    # Determine file extension from the original filename (default: .webm)
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    upload_dir = Path(settings.UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    audio_path = str(upload_dir / f"{session_id}{suffix}")

    # Stream to disk in 1 MB chunks to avoid loading the full file into memory
    async with aiofiles.open(audio_path, "wb") as dest:
        while chunk := await file.read(1024 * 1024):
            await dest.write(chunk)

    await db.execute(
        sa_update(Session)
        .where(Session.id == session_id)
        .values(status=SessionStatus.PROCESSING, audio_path=audio_path)
    )
    await db.commit()

    background_tasks.add_task(run_pipeline, str(session_id), audio_path, speakers_expected, language_code)

    return {
        "detail": "Audio received, transcription pipeline started",
        "session_id": str(session_id),
    }


# ── Background pipeline runner ────────────────────────────────────────────────


async def run_pipeline(
    session_id: str,
    audio_path: str,
    speakers_expected: int | None = None,
    language_code: str | None = None,
) -> None:
    """Background task: run the full LangGraph pipeline and persist all results.

    Executes pipeline_graph.invoke() via asyncio.to_thread() because both the
    AssemblyAI SDK and the LangChain LLM calls are synchronous. Running in a
    thread pool keeps the event loop unblocked during the 1–5 minute window.

    On success:
        - Utterance rows bulk-inserted (with intention / sentiment / issues)
        - Report row inserted with the final structured JSON
        - session.status updated to 'done'

    On any failure:
        - All DB changes rolled back
        - session.status updated to 'error'
        - Exception logged (never re-raised — background tasks must not crash)
    """
    # Use a fresh session factory (not the request-scoped DI session, which
    # is already closed by the time the background task executes).
    async with AsyncSessionLocal() as db:
        try:
            initial_state: PipelineState = {
                "session_id": session_id,
                "audio_path": audio_path,
                "speakers_expected": speakers_expected,
                "language_code": language_code,
                "utterances": [],
                "analyzed_utterances": [],
                "report": None,
            }

            # The full graph (transcription + LLM analysis loop + report) is
            # synchronous — run in a thread pool to avoid blocking the event loop.
            final_state: PipelineState = await asyncio.to_thread(
                pipeline_graph.invoke, initial_state
            )

            # Persist utterances enriched with LLM analysis
            utterance_rows = [
                Utterance(
                    session_id=uuid.UUID(session_id),
                    speaker=u["speaker"],
                    start_time=u["start"],
                    end_time=u["end"],
                    text=u["text"],
                    intention=u.get("intention"),
                    sentiment=u.get("sentiment"),
                    issues=u.get("issues") or [],
                )
                for u in final_state["analyzed_utterances"]
            ]
            db.add_all(utterance_rows)

            # Persist the final report
            report_row = Report(
                session_id=uuid.UUID(session_id),
                content=final_state["report"],
            )
            db.add(report_row)

            await db.execute(
                sa_update(Session)
                .where(Session.id == uuid.UUID(session_id))
                .values(status=SessionStatus.DONE)
            )
            await db.commit()

            logger.info(
                "Pipeline complete for session %s: %d utterances, report generated",
                session_id,
                len(final_state["analyzed_utterances"]),
            )

        except TranscriptionError as exc:
            logger.error(
                "Transcription error for session %s: %s", session_id, exc
            )
            await _mark_session_error(db, session_id)

        except Exception:
            logger.exception(
                "Unexpected pipeline failure for session %s", session_id
            )
            await _mark_session_error(db, session_id)


async def _mark_session_error(db: AsyncSession, session_id: str) -> None:
    """Roll back any pending changes and set session.status to 'error'."""
    try:
        await db.rollback()
        await db.execute(
            sa_update(Session)
            .where(Session.id == uuid.UUID(session_id))
            .values(status=SessionStatus.ERROR)
        )
        await db.commit()
    except Exception:
        logger.exception(
            "Failed to mark session %s as error — DB may be unavailable",
            session_id,
        )
