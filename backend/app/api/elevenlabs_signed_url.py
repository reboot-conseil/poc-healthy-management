"""Signed URL endpoint for ElevenLabs conversational AI avatar sessions.

Flow:
  1. Client POSTs to /api/elevenlabs/signed-url (with optional dynamic_variables)
  2. Backend calls Mascot Bot proxy with ElevenLabs provider config
  3. Mascot Bot returns a signed WebSocket URL with automatic viseme injection
  4. Client uses the signed URL to start a conversation via @elevenlabs/react
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

_MASCOT_SIGNED_URL = "https://api.mascot.bot/v1/get-signed-url"


class SignedUrlRequest(BaseModel):
    dynamic_variables: dict[str, Any] | None = None


@router.post("/api/elevenlabs/signed-url")
async def get_elevenlabs_signed_url(body: SignedUrlRequest) -> dict:
    """Generate a Mascot Bot signed WebSocket URL for an ElevenLabs avatar session."""
    if not settings.ELEVENLABS_API_KEY:
        raise HTTPException(status_code=500, detail="ELEVENLABS_API_KEY not configured")
    if not settings.ELEVENLABS_AGENT_ID:
        raise HTTPException(status_code=500, detail="ELEVENLABS_AGENT_ID not configured")
    if not settings.MASCOT_BOT_API_KEY:
        raise HTTPException(status_code=500, detail="MASCOT_BOT_API_KEY not configured")

    provider_config: dict[str, Any] = {
        "agent_id": settings.ELEVENLABS_AGENT_ID,
        "api_key": settings.ELEVENLABS_API_KEY,
    }
    if body.dynamic_variables:
        provider_config["dynamic_variables"] = body.dynamic_variables

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            _MASCOT_SIGNED_URL,
            headers={
                "Authorization": f"Bearer {settings.MASCOT_BOT_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "config": {
                    "provider": "elevenlabs",
                    "provider_config": provider_config,
                }
            },
        )

    if not resp.is_success:
        logger.error(
            "Mascot Bot signed URL error: status=%d body=%s",
            resp.status_code,
            resp.text,
        )
        raise HTTPException(
            status_code=502,
            detail=f"Mascot Bot error {resp.status_code}: {resp.text}",
        )

    data = resp.json()
    return {"signedUrl": data["signed_url"]}
