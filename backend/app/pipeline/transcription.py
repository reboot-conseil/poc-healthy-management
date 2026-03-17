"""AssemblyAI integration for full-file speech-to-text with speaker diarisation.

Design constraints (from AGENTS.md):
- Always send the **complete** audio file — never chunk it for AssemblyAI.
- speaker_labels=True is mandatory for diarisation.
- language_detection=True is ALWAYS enabled (required for speech_models routing).
  When the session language is known, pass language_code to restrict detection
  via language_detection_options.expected_languages — this constrains the model
  to the specified language without disabling language_detection, which preserves
  the full model-routing benefit of speech_models.
  NOTE: language_code (the raw API field) and language_detection are mutually
  exclusive. We therefore never pass language_code directly; instead we use
  language_detection_options when a language hint is available.
- For speaker count, speakers_expected is used as a strict constraint. Only pass
  it when certain of the exact count — a correct strict count suppresses ghost
  labels far better than a loose range. If the count is unknown, omit it entirely.
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


def transcribe_audio(
    audio_path: str,
    speakers_expected: int | None = None,
    language_code: str | None = None,
) -> list[dict]:
    """Transcribe a full audio file with AssemblyAI and return diarised utterances.

    Sends the complete file to AssemblyAI — never chunked — to preserve
    diarisation accuracy across the whole session (AGENTS.md requirement).

    The call is **synchronous** and may block for 1–3 minutes on long sessions.
    Always invoke this function inside asyncio.to_thread() from async contexts.

    Args:
        audio_path: Path to the audio file (WebM/Opus, MP3, WAV, etc.).
        speakers_expected: Exact number of participants when known. Passed directly
            as `speakers_expected` to constrain the diarisation model tightly to
            that count — the safest option when you are certain of the number, as it
            prevents the model from creating extra ghost labels. Leave None for
            automatic detection (default range: 1–10 speakers).
        language_code: BCP-47 language code (e.g. "fr", "en", "es"). When set,
            constrains language_detection via language_detection_options.expected_languages
            so the detection is restricted to that language. This preserves
            language_detection=True (required for speech_models routing) while
            removing language ambiguity that could degrade short-segment diarisation.
            When None, detection runs unconstrained across all supported languages.

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

    lang_mode = f"expected_languages=[{language_code}]" if language_code else "unconstrained"
    spk_mode = str(speakers_expected) if speakers_expected is not None else "auto"
    logger.info(
        "Starting AssemblyAI transcription: lang=%s, speakers=%s, file=%s",
        lang_mode, spk_mode, audio_path,
    )

    aai.settings.api_key = settings.ASSEMBLYAI_API_KEY

    # language_detection=True is ALWAYS on — required for speech_models routing.
    # When a language hint is given, we restrict detection to that language via
    # language_detection_options.expected_languages rather than passing language_code
    # directly (language_code and language_detection are mutually exclusive in the
    # raw API; using language_detection_options keeps model routing intact).
    lang_detection_opts = None
    if language_code:
        lang_detection_opts = aai.LanguageDetectionOptions(
            expected_languages=[language_code],
            fallback_language=language_code,
        )

    config = aai.TranscriptionConfig(
        # Priority-ordered model list: U3 Pro for FR/EN/ES/PT/DE/IT (highest
        # accuracy), automatic fallback to Universal-2 for all other languages.
        speech_models=settings.assemblyai_speech_models_list,
        speaker_labels=True,
        language_detection=True,
        language_detection_options=lang_detection_opts,
        # Strict speaker count: when the caller knows the exact number of
        # participants, constraining the model to that count suppresses ghost
        # labels. The caller should only set this when confident — a wrong count
        # forces the model to split or merge real speakers.
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
