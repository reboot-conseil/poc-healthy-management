"""Gemini Live relay — two WebSocket endpoints:

/api/tts/ws   One-shot TTS: send text, receive audio, done.
/api/tts/live Persistent session: stream mic PCM in, Gemini audio out.
              The live endpoint keeps a single Gemini Live session open for
              the entire recording so Gemini hears the participants and
              responds naturally.

Protocol (all frames are JSON text):
  /ws   client→server:  {"text": "..."}
        server→client:  {"type":"audio","data":"<b64 PCM>"}  {"type":"done"}

  /live client→server:  {"type":"audio","data":"<b64 PCM 16kHz>"}  (mic chunks)
        server→client:  {"type":"audio","data":"<b64 PCM 24kHz>"}  (AI speech)
                        {"type":"turn_complete"}

Audio output format: signed 16-bit PCM, little-endian, mono, 24 000 Hz.
Audio input format:  signed 16-bit PCM, little-endian, mono, 16 000 Hz.
"""

import asyncio
import base64
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tts", tags=["tts"])

_MODEL = "gemini-live-2.5-flash-native-audio"
_TTS_INSTRUCTION = (
    "Tu es un facilitateur de workathon. "
    "Lis le texte fourni naturellement en français, avec une voix claire et posée."
)
_LIVE_INSTRUCTION = (
    "Tu es un facilitateur expert en intelligence collective et en workathons. "
    "Tu accompagnes un groupe de participants en session de travail. "
    "Tu écoutes leurs échanges et interviens de façon concise et utile quand on te parle directement. "
    "Réponds toujours en français, avec une voix naturelle et bienveillante. "
    "Tes réponses doivent être courtes (deux ou trois phrases maximum) sauf si on te demande un développement. "
    "Lorsque tu reçois un message commençant par 'CONTEXTE:', il s'agit d'une mise à jour informative "
    "sur l'étape en cours du workathon. Tu dois intégrer cette information silencieusement "
    "sans répondre verbalement — utilise-la uniquement pour mieux contextualiser tes futures interventions."
)


def _get_client() -> genai.Client:
    """Build a Vertex AI genai client using Application Default Credentials."""
    return genai.Client(
        vertexai=True,
        project=settings.GOOGLE_CLOUD_PROJECT,
        location=settings.GOOGLE_CLOUD_LOCATION,
    )


@router.websocket("/ws")
async def tts_relay(websocket: WebSocket) -> None:
    """Relay a text narration request to Gemini Live and stream audio back."""
    await websocket.accept()

    try:
        raw = await websocket.receive_text()
        payload = json.loads(raw)
        text: str = payload.get("text", "").strip()

        if not text:
            await websocket.send_text(
                json.dumps({"type": "error", "message": "Empty text"})
            )
            return

        client = _get_client()

        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=_TTS_INSTRUCTION,
        )

        async with client.aio.live.connect(model=_MODEL, config=config) as session:
            await session.send(input=text, end_of_turn=True)

            async for response in session.receive():
                if response.data is not None:
                    b64 = base64.b64encode(response.data).decode()
                    await websocket.send_text(
                        json.dumps({"type": "audio", "data": b64})
                    )

                server_content = getattr(response, "server_content", None)
                if server_content and getattr(server_content, "turn_complete", False):
                    break

        await websocket.send_text(json.dumps({"type": "done"}))

    except WebSocketDisconnect:
        logger.info("TTS WebSocket client disconnected")
    except Exception:
        logger.exception("TTS relay error")
        try:
            await websocket.send_text(
                json.dumps({"type": "error", "message": "Internal relay error"})
            )
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/live")
async def live_relay(websocket: WebSocket) -> None:
    """Persistent Gemini Live session for the duration of a recording.

    The frontend streams microphone PCM (16 kHz) and receives Gemini audio
    responses (24 kHz) for the whole session — Gemini hears the participants
    and responds when spoken to.
    """
    await websocket.accept()

    client = _get_client()
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=_LIVE_INSTRUCTION,
    )

    async def _forward_from_client(
        ws: WebSocket, session: genai.live.AsyncSession
    ) -> None:
        """Read mic audio from the browser and push it to Gemini."""
        async for raw in ws.iter_text():
            msg = json.loads(raw)
            if msg.get("type") == "audio":
                pcm = base64.b64decode(msg["data"])
                await session.send(
                    input=types.Blob(data=pcm, mime_type="audio/pcm;rate=16000"),
                    end_of_turn=False,
                )
            elif msg.get("type") == "context":
                await session.send(input=msg["message"], end_of_turn=False)

    async def _forward_from_gemini(
        session: genai.live.AsyncSession, ws: WebSocket
    ) -> None:
        """Stream Gemini audio responses back to the browser."""
        async for response in session.receive():
            if response.data is not None:
                b64 = base64.b64encode(response.data).decode()
                await ws.send_text(json.dumps({"type": "audio", "data": b64}))

            sc = getattr(response, "server_content", None)
            if sc and getattr(sc, "turn_complete", False):
                await ws.send_text(json.dumps({"type": "turn_complete"}))

    try:
        async with client.aio.live.connect(model=_MODEL, config=config) as session:
            t_client = asyncio.create_task(_forward_from_client(websocket, session))
            t_gemini = asyncio.create_task(_forward_from_gemini(session, websocket))
            done, pending = await asyncio.wait(
                [t_client, t_gemini],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

    except WebSocketDisconnect:
        logger.info("Live WebSocket client disconnected")
    except Exception:
        logger.exception("Live relay error")
        try:
            await websocket.send_text(
                json.dumps({"type": "error", "message": "Live relay error"})
            )
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
