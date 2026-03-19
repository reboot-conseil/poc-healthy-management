"""Report retrieval endpoint.

Endpoint:
    GET /reports/{session_id}

Returns:
    200 + report JSON   when session status == 'done' and report exists
    202 Accepted        when session status == 'processing' (still running)
    404                 when session does not exist
    409                 when session is done but report row is missing (data integrity issue)

The report is assembled on-the-fly from the utterances already persisted by the
transcription pipeline.  The LangGraph analysis phase (intention / sentiment /
improvement_axes) is not yet implemented, so those fields are returned as null /
empty for now.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.report import Report
from app.models.session import Session, SessionStatus
from app.models.utterance import Utterance

router = APIRouter(prefix="/reports", tags=["reports"])


# ── Pydantic response schema ──────────────────────────────────────────────────


class ReportResponse(BaseModel):
    """Report payload returned to the frontend.

    The content field is the raw JSONB object stored by report_node:
        {
            "synthesis": str,
            "improvement_axes": [str, ...],
            "utterances": [{speaker, start, end, text, intention, sentiment, issues}, ...]
        }
    """

    session_id: uuid.UUID
    report_id: uuid.UUID
    content: dict

    model_config = {"from_attributes": True}


# ── Endpoint ──────────────────────────────────────────────────────────────────


@router.get("/{session_id}", response_model=ReportResponse)
async def get_report(
    session_id: uuid.UUID,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> ReportResponse:
    """Return the final analysis report for a session.

    The frontend polls this endpoint every 5 seconds while status != 'done'.
    A 202 response means the pipeline is still running — no report yet.
    A 200 response includes the full structured report JSON.
    """
    session = await db.get(Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.status == SessionStatus.PROCESSING:
        response.status_code = 202
        raise HTTPException(
            status_code=202, detail="Pipeline still processing — try again later"
        )

    if session.status == SessionStatus.ERROR:
        raise HTTPException(status_code=500, detail="Pipeline failed for this session")

    if session.status == SessionStatus.RECORDING:
        raise HTTPException(
            status_code=409,
            detail="Session is still recording — no audio has been uploaded yet",
        )

    # Status is 'done' — fetch the report row
    result = await db.execute(select(Report).where(Report.session_id == session_id))
    report = result.scalar_one_or_none()

    if report is None:
        # Should not happen for a healthy pipeline completion, but handle gracefully
        raise HTTPException(
            status_code=409,
            detail="Session is marked done but no report was found — data integrity issue",
        )

    return ReportResponse(
        session_id=session_id,
        report_id=report.id,
        content=report.content,
    )
