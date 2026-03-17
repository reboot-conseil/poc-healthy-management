"""AssemblyAI integration for full-file speech-to-text with speaker diarisation.

Design constraints (from AGENTS.md):
- Always send the **complete** audio file — never chunk it for AssemblyAI.
- speaker_labels=True is mandatory for diarisation.
- language_detection=True is safer than hardcoding "fr" for mixed-language sessions.
- This module is intentionally synchronous. Callers in an async context must wrap
  transcribe_audio() with asyncio.to_thread() to avoid blocking the event loop.
"""

import logging
import re
from pathlib import Path
from typing import Optional

import assemblyai as aai
import mutagen

from app.config import settings

logger = logging.getLogger(__name__)


class TranscriptionError(Exception):
    """Raised when AssemblyAI transcription fails or produces unusable output."""


# ── Internal helpers ──────────────────────────────────────────────────────────


def _get_audio_duration(audio_path: str) -> Optional[float]:
    """Return audio duration in seconds via mutagen, or None if unreadable.

    mutagen supports WebM/Opus (the format produced by browser MediaRecorder)
    as well as MP3, OGG, WAV, and most other common containers. Returning None
    instead of raising lets the caller decide whether to skip the pre-check.
    """
    try:
        audio_info = mutagen.File(audio_path)
        if audio_info is not None:
            return float(audio_info.info.length)
    except Exception:
        # Unrecognised format — skip the pre-check; AssemblyAI will reject it
        # with a descriptive error if the file is genuinely unusable.
        pass
    return None


def _normalize_speaker(raw: str) -> str:
    """Strip the SPEAKER_ prefix from AssemblyAI speaker labels.

    AssemblyAI may return "SPEAKER_A" or simply "A" depending on the SDK
    version. Normalise to a single letter / identifier for consistency.

    Examples:
        "SPEAKER_A"  → "A"
        "SPEAKER_00" → "00"
        "A"          → "A"   (already normalised, no-op)
    """
    return re.sub(r"^SPEAKER_", "", raw)


# ── Public API ────────────────────────────────────────────────────────────────


def transcribe_audio(audio_path: str, speakers_expected: int | None = None) -> list[dict]:
    """Transcribe a full audio file with AssemblyAI and return diarised utterances.

    Sends the complete file to AssemblyAI — never chunked — to preserve
    diarisation accuracy across the whole session (AGENTS.md requirement).

    The call is **synchronous** and may block for 1–3 minutes on long sessions.
    Always invoke this function inside asyncio.to_thread() from async contexts.

    Args:
        audio_path: Path to the audio file (WebM/Opus, MP3, WAV, etc.).
        speakers_expected: Known number of participants. When provided, constrains
            the diarisation model and significantly reduces split-speaker errors
            (e.g. the same person assigned two different labels). Leave None to
            let AssemblyAI auto-detect (less accurate on short utterances).

    Returns:
        List of utterance dicts ordered by start time:
            [{"speaker": "A", "start": 4.2, "end": 8.1, "text": "Bonjour..."}]
        Timestamps are in **seconds** (AssemblyAI returns milliseconds).

    Raises:
        TranscriptionError: File not found, audio < 2 s, API error, empty result.
    """
    path = Path(audio_path)
    if not path.exists():
        raise TranscriptionError(f"Audio file not found: {audio_path}")

    # Guard: reject obviously too-short audio before making a paid API call.
    # mutagen returns None for unrecognised containers — in that case we skip
    # the check and let AssemblyAI produce a meaningful error if needed.
    duration = _get_audio_duration(audio_path)
    if duration is not None and duration < 2.0:
        raise TranscriptionError(
            f"Audio too short: {duration:.2f}s (minimum 2.0s required)"
        )

    logger.info("Starting AssemblyAI transcription for: %s", audio_path)

    aai.settings.api_key = settings.ASSEMBLYAI_API_KEY

    config = aai.TranscriptionConfig(
        # Priority-ordered model list: U3 Pro for FR/EN/ES/PT/DE/IT (highest
        # accuracy), automatic fallback to Universal-2 for all other languages.
        speech_models=settings.assemblyai_speech_models_list,
        speaker_labels=True,
        language_detection=True,
        # Constraining the expected speaker count reduces split-label errors.
        # Only set when the value is known — passing a wrong count makes it worse.
        speakers_expected=speakers_expected,
    )

    try:
        transcriber = aai.Transcriber()
        # transcriber.transcribe() is synchronous and polls until completion.
        transcript = transcriber.transcribe(str(path), config=config)
    except aai.AssemblyAIError as exc:
        raise TranscriptionError(f"AssemblyAI SDK error: {exc}") from exc

    if transcript.status == aai.TranscriptStatus.error:
        raise TranscriptionError(
            f"AssemblyAI transcription failed: {transcript.error}"
        )

    if not transcript.utterances:
        raise TranscriptionError(
            "No utterances returned by AssemblyAI "
            "(audio may contain no speech or diarisation produced no output)"
        )

    utterances = [
        {
            "speaker": _normalize_speaker(u.speaker),
            # AssemblyAI returns timestamps in milliseconds → convert to seconds
            "start": u.start / 1000.0,
            "end": u.end / 1000.0,
            "text": u.text,
        }
        for u in transcript.utterances
    ]

    model_used = (transcript.json_response or {}).get("speech_model_used", "unknown")
    logger.info(
        "Transcription complete: %d utterances, duration=%.1fs, model=%s",
        len(utterances),
        transcript.audio_duration or 0,
        model_used,
    )

    return utterances
