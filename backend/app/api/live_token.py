"""Ephemeral token endpoint for Mascotbot + Gemini Live sessions.

Flow:
  1. Generate a single-use Google ephemeral token via the google-genai SDK
     (API key stays server-side)
  2. Exchange it with Mascotbot for a wrapped token that proxies Gemini Live
  3. Return { baseUrl, ephemeralToken, model } to the client
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException
from google import genai

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

_GEMINI_MODEL = "gemini-live-2.5-flash-native-audio"
_VOICE_NAME = "Aoede"  # female voice
_SYSTEM_INSTRUCTION = (
    "Tu es Aria, une facilitatrice IA bienveillante et experte en workathons. "
    "Tu guides les participants à travers les étapes de la session de manière claire et concise. "
    "Tu réponds toujours en français, avec un ton chaleureux et professionnel. "
    "Tes réponses sont courtes et directes pour ne pas interrompre le flux de la session."
)

_MASCOT_SIGNED_URL = "https://api.mascot.bot/v1/get-signed-url"


@router.get("/api/live/token")
async def get_live_token() -> dict:
    """Generate a Mascotbot-wrapped Gemini ephemeral token for a live session."""
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")
    if not settings.MASCOT_BOT_API_KEY:
        raise HTTPException(status_code=500, detail="MASCOT_BOT_API_KEY not configured")

    # Step 1 — Google ephemeral token via SDK (handles correct endpoint internally)
    try:
        ai_client = genai.Client(
            api_key=settings.GEMINI_API_KEY,
            http_options={"api_version": "v1alpha"},
        )
        google_token = await ai_client.aio.auth_tokens.create(
            config={
                "uses": 1,
                "live_connect_constraints": {
                    "model": _GEMINI_MODEL,
                    "config": {
                        "response_modalities": ["AUDIO"],
                        "system_instruction": {
                            "parts": [{"text": _SYSTEM_INSTRUCTION}]
                        },
                        "speech_config": {
                            "voice_config": {
                                "prebuilt_voice_config": {"voice_name": _VOICE_NAME}
                            }
                        },
                    },
                },
            }
        )
        google_token_name: str = google_token.name
    except Exception as exc:
        logger.error("Google ephemeral token error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Google token error: {exc}") from exc

    # Step 2 — Exchange for Mascotbot-wrapped token
    async with httpx.AsyncClient(timeout=30.0) as client:
        mascot_resp = await client.post(
            _MASCOT_SIGNED_URL,
            headers={
                "Authorization": f"Bearer {settings.MASCOT_BOT_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "config": {
                    "provider": "gemini",
                    "provider_config": {
                        "ephemeral_token": google_token_name,
                        "model": _GEMINI_MODEL,
                    },
                }
            },
        )
        if not mascot_resp.is_success:
            logger.error(
                "Mascotbot signed URL error: status=%d body=%s",
                mascot_resp.status_code,
                mascot_resp.text,
            )
            raise HTTPException(
                status_code=502,
                detail=f"Mascotbot error {mascot_resp.status_code}: {mascot_resp.text}",
            )
        mascot_data = mascot_resp.json()

    return {
        "baseUrl": "https://api.mascot.bot",
        "ephemeralToken": mascot_data["api_key"],
        "model": _GEMINI_MODEL,
    }
