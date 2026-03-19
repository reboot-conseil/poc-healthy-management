"""Script management endpoints.

Endpoints:
    GET    /api/scripts              List all scripts
    POST   /api/scripts              Create a new script
    GET    /api/scripts/{id}         Get a single script
    PUT    /api/scripts/{id}         Full update of a script
    DELETE /api/scripts/{id}         Delete a script (204)
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.script import Script

router = APIRouter(prefix="/api/scripts", tags=["scripts"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────


class ScriptStepSchema(BaseModel):
    title: str
    description: str
    duration: int

    @model_validator(mode="before")
    @classmethod
    def _migrate_narration(cls, data: object) -> object:
        """Accept legacy 'narration' field from existing DB rows."""
        if isinstance(data, dict) and "description" not in data and "narration" in data:
            data = {**data, "description": data["narration"]}
        return data


class ScriptCreate(BaseModel):
    title: str
    steps: list[ScriptStepSchema]


class ScriptOut(BaseModel):
    id: uuid.UUID
    title: str
    steps: list[ScriptStepSchema]
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("", response_model=list[ScriptOut])
async def list_scripts(
    db: AsyncSession = Depends(get_db),
) -> list[Script]:
    """Return all scripts ordered by creation date (most recent first)."""
    result = await db.execute(select(Script).order_by(Script.created_at.desc()))
    return list(result.scalars().all())


@router.post("", status_code=201, response_model=ScriptOut)
async def create_script(
    body: ScriptCreate,
    db: AsyncSession = Depends(get_db),
) -> Script:
    """Create a new workathon script."""
    script = Script(
        title=body.title,
        steps=[step.model_dump() for step in body.steps],
    )
    db.add(script)
    await db.commit()
    await db.refresh(script)
    return script


@router.get("/{script_id}", response_model=ScriptOut)
async def get_script(
    script_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Script:
    """Return a single script by ID."""
    script = await db.get(Script, script_id)
    if script is None:
        raise HTTPException(status_code=404, detail="Script not found")
    return script


@router.put("/{script_id}", response_model=ScriptOut)
async def update_script(
    script_id: uuid.UUID,
    body: ScriptCreate,
    db: AsyncSession = Depends(get_db),
) -> Script:
    """Full update of a script's title and steps."""
    script = await db.get(Script, script_id)
    if script is None:
        raise HTTPException(status_code=404, detail="Script not found")
    script.title = body.title
    script.steps = [step.model_dump() for step in body.steps]
    await db.commit()
    await db.refresh(script)
    return script


@router.delete("/{script_id}", status_code=204)
async def delete_script(
    script_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Delete a script. Returns 204 No Content on success."""
    script = await db.get(Script, script_id)
    if script is None:
        raise HTTPException(status_code=404, detail="Script not found")
    await db.delete(script)
    await db.commit()
    return Response(status_code=204)
