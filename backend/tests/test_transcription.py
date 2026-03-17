"""Unit tests for backend/app/pipeline/transcription.py.

All external dependencies (AssemblyAI SDK, mutagen, filesystem) are mocked so
tests are fast and hermetic — no network calls, no real audio files required.
"""

from unittest.mock import MagicMock, patch

import assemblyai as aai
import pytest

from app.pipeline.transcription import (
    TranscriptionError,
    _normalize_speaker,
    transcribe_audio,
)


# ── Fixture helpers ───────────────────────────────────────────────────────────


def _make_utterance(speaker: str, start_ms: int, end_ms: int, text: str) -> MagicMock:
    """Build a mock AssemblyAI Utterance object."""
    u = MagicMock()
    u.speaker = speaker
    u.start = start_ms
    u.end = end_ms
    u.text = text
    return u


def _make_transcript(
    status: aai.TranscriptStatus,
    utterances: list | None = None,
    error: str | None = None,
    audio_duration: float = 60.0,
) -> MagicMock:
    """Build a mock AssemblyAI Transcript object."""
    transcript = MagicMock()
    transcript.status = status
    transcript.utterances = utterances if utterances is not None else []
    transcript.error = error
    transcript.audio_duration = audio_duration
    return transcript


def _readable_audio(mock_mutagen_file: MagicMock, duration: float = 10.0) -> None:
    """Configure mutagen mock to report a readable file with the given duration."""
    mock_info = MagicMock()
    mock_info.length = duration
    mock_audio = MagicMock()
    mock_audio.info = mock_info
    mock_mutagen_file.return_value = mock_audio


# ── Happy path ────────────────────────────────────────────────────────────────


@patch("pathlib.Path.exists", return_value=True)
@patch("app.pipeline.transcription.mutagen.File")
@patch("app.pipeline.transcription.aai.Transcriber")
def test_happy_path_returns_correct_utterance_shape(
    mock_transcriber_cls: MagicMock,
    mock_mutagen_file: MagicMock,
    _mock_exists: MagicMock,
) -> None:
    """transcribe_audio returns a list of correctly shaped utterance dicts."""
    _readable_audio(mock_mutagen_file)

    raw_utterances = [
        _make_utterance("A", 4200, 8100, "Bonjour tout le monde"),
        _make_utterance("B", 9000, 12500, "Merci pour votre présence"),
    ]
    mock_transcriber_cls.return_value.transcribe.return_value = _make_transcript(
        aai.TranscriptStatus.completed,
        utterances=raw_utterances,
    )

    result = transcribe_audio("/fake/session.webm")

    assert len(result) == 2
    # Timestamps must be converted from milliseconds to seconds
    assert result[0] == {
        "speaker": "A",
        "start": 4.2,
        "end": 8.1,
        "text": "Bonjour tout le monde",
    }
    assert result[1] == {
        "speaker": "B",
        "start": 9.0,
        "end": 12.5,
        "text": "Merci pour votre présence",
    }


@patch("pathlib.Path.exists", return_value=True)
@patch("app.pipeline.transcription.mutagen.File")
@patch("app.pipeline.transcription.aai.Transcriber")
def test_sdk_called_with_speaker_labels_and_language_detection(
    mock_transcriber_cls: MagicMock,
    mock_mutagen_file: MagicMock,
    _mock_exists: MagicMock,
) -> None:
    """AssemblyAI must always be called with speaker_labels=True and language_detection=True."""
    _readable_audio(mock_mutagen_file)

    mock_transcriber_cls.return_value.transcribe.return_value = _make_transcript(
        aai.TranscriptStatus.completed,
        utterances=[_make_utterance("A", 0, 3000, "Test")],
    )

    transcribe_audio("/fake/session.webm")

    _call_kwargs = mock_transcriber_cls.return_value.transcribe.call_args
    config: aai.TranscriptionConfig = _call_kwargs[1]["config"]
    assert config.speaker_labels is True
    assert config.language_detection is True


# ── Error status ──────────────────────────────────────────────────────────────


@patch("pathlib.Path.exists", return_value=True)
@patch("app.pipeline.transcription.mutagen.File")
@patch("app.pipeline.transcription.aai.Transcriber")
def test_error_status_raises_transcription_error(
    mock_transcriber_cls: MagicMock,
    mock_mutagen_file: MagicMock,
    _mock_exists: MagicMock,
) -> None:
    """TranscriptionError is raised when AssemblyAI returns an error status."""
    _readable_audio(mock_mutagen_file)

    mock_transcriber_cls.return_value.transcribe.return_value = _make_transcript(
        aai.TranscriptStatus.error,
        error="Audio file format not supported",
    )

    with pytest.raises(TranscriptionError, match="Audio file format not supported"):
        transcribe_audio("/fake/session.webm")


@patch("pathlib.Path.exists", return_value=True)
@patch("app.pipeline.transcription.mutagen.File")
@patch("app.pipeline.transcription.aai.Transcriber")
def test_sdk_error_raises_transcription_error(
    mock_transcriber_cls: MagicMock,
    mock_mutagen_file: MagicMock,
    _mock_exists: MagicMock,
) -> None:
    """TranscriptionError wraps aai.AssemblyAIError raised by the SDK."""
    _readable_audio(mock_mutagen_file)

    mock_transcriber_cls.return_value.transcribe.side_effect = aai.AssemblyAIError(
        "Connection timeout"
    )

    with pytest.raises(TranscriptionError, match="AssemblyAI SDK error"):
        transcribe_audio("/fake/session.webm")


# ── Empty utterances ──────────────────────────────────────────────────────────


@patch("pathlib.Path.exists", return_value=True)
@patch("app.pipeline.transcription.mutagen.File")
@patch("app.pipeline.transcription.aai.Transcriber")
def test_empty_utterances_raises_transcription_error(
    mock_transcriber_cls: MagicMock,
    mock_mutagen_file: MagicMock,
    _mock_exists: MagicMock,
) -> None:
    """TranscriptionError is raised when the transcript contains no utterances."""
    _readable_audio(mock_mutagen_file)

    mock_transcriber_cls.return_value.transcribe.return_value = _make_transcript(
        aai.TranscriptStatus.completed,
        utterances=[],
    )

    with pytest.raises(TranscriptionError, match="No utterances"):
        transcribe_audio("/fake/session.webm")


@patch("pathlib.Path.exists", return_value=True)
@patch("app.pipeline.transcription.mutagen.File")
@patch("app.pipeline.transcription.aai.Transcriber")
def test_none_utterances_raises_transcription_error(
    mock_transcriber_cls: MagicMock,
    mock_mutagen_file: MagicMock,
    _mock_exists: MagicMock,
) -> None:
    """TranscriptionError is raised when transcript.utterances is None."""
    _readable_audio(mock_mutagen_file)

    transcript = _make_transcript(aai.TranscriptStatus.completed)
    transcript.utterances = None  # SDK may return None instead of []
    mock_transcriber_cls.return_value.transcribe.return_value = transcript

    with pytest.raises(TranscriptionError, match="No utterances"):
        transcribe_audio("/fake/session.webm")


# ── Short audio guard ─────────────────────────────────────────────────────────


@patch("pathlib.Path.exists", return_value=True)
@patch("app.pipeline.transcription.mutagen.File")
@patch("app.pipeline.transcription.aai.Transcriber")
def test_short_audio_raises_before_sdk_call(
    mock_transcriber_cls: MagicMock,
    mock_mutagen_file: MagicMock,
    _mock_exists: MagicMock,
) -> None:
    """TranscriptionError is raised for audio < 2s — the SDK must NOT be called."""
    _readable_audio(mock_mutagen_file, duration=1.5)

    with pytest.raises(TranscriptionError, match="too short"):
        transcribe_audio("/fake/short.webm")

    # Guard fires before any network call is made
    mock_transcriber_cls.return_value.transcribe.assert_not_called()


@patch("pathlib.Path.exists", return_value=True)
@patch("app.pipeline.transcription.mutagen.File")
@patch("app.pipeline.transcription.aai.Transcriber")
def test_exactly_two_seconds_passes_guard(
    mock_transcriber_cls: MagicMock,
    mock_mutagen_file: MagicMock,
    _mock_exists: MagicMock,
) -> None:
    """Audio exactly at the 2.0s boundary must not be rejected by the pre-check."""
    _readable_audio(mock_mutagen_file, duration=2.0)

    mock_transcriber_cls.return_value.transcribe.return_value = _make_transcript(
        aai.TranscriptStatus.completed,
        utterances=[_make_utterance("A", 0, 2000, "OK")],
    )

    result = transcribe_audio("/fake/borderline.webm")
    assert len(result) == 1


@patch("pathlib.Path.exists", return_value=True)
@patch("app.pipeline.transcription.mutagen.File")
@patch("app.pipeline.transcription.aai.Transcriber")
def test_unreadable_format_skips_duration_check(
    mock_transcriber_cls: MagicMock,
    mock_mutagen_file: MagicMock,
    _mock_exists: MagicMock,
) -> None:
    """When mutagen cannot read the file, the duration pre-check is skipped gracefully."""
    # mutagen.File returns None for unrecognised formats
    mock_mutagen_file.return_value = None

    mock_transcriber_cls.return_value.transcribe.return_value = _make_transcript(
        aai.TranscriptStatus.completed,
        utterances=[_make_utterance("A", 0, 5000, "Contenu audio")],
    )

    # Must not raise — the SDK call proceeds without the pre-check
    result = transcribe_audio("/fake/unknown_format.bin")
    assert len(result) == 1


# ── File not found ────────────────────────────────────────────────────────────


@patch("pathlib.Path.exists", return_value=False)
def test_missing_file_raises_transcription_error(_mock_exists: MagicMock) -> None:
    """TranscriptionError is raised immediately when the audio file does not exist."""
    with pytest.raises(TranscriptionError, match="not found"):
        transcribe_audio("/does/not/exist.webm")


# ── Speaker label normalisation ───────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("SPEAKER_A", "A"),
        ("SPEAKER_B", "B"),
        ("SPEAKER_00", "00"),
        ("SPEAKER_Z", "Z"),
        # Already normalised — no-op
        ("A", "A"),
        ("B", "B"),
        ("00", "00"),
    ],
)
def test_normalize_speaker(raw: str, expected: str) -> None:
    """_normalize_speaker strips the SPEAKER_ prefix from AssemblyAI labels."""
    assert _normalize_speaker(raw) == expected


@patch("pathlib.Path.exists", return_value=True)
@patch("app.pipeline.transcription.mutagen.File")
@patch("app.pipeline.transcription.aai.Transcriber")
def test_speaker_normalization_applied_to_output(
    mock_transcriber_cls: MagicMock,
    mock_mutagen_file: MagicMock,
    _mock_exists: MagicMock,
) -> None:
    """SPEAKER_ prefix is stripped in the final utterance dicts returned."""
    _readable_audio(mock_mutagen_file)

    raw_utterances = [
        _make_utterance("SPEAKER_A", 0, 3000, "Premier locuteur"),
        _make_utterance("SPEAKER_B", 4000, 7000, "Deuxième locuteur"),
    ]
    mock_transcriber_cls.return_value.transcribe.return_value = _make_transcript(
        aai.TranscriptStatus.completed,
        utterances=raw_utterances,
    )

    result = transcribe_audio("/fake/session.webm")

    assert result[0]["speaker"] == "A"
    assert result[1]["speaker"] == "B"


# ── Millisecond → second conversion ──────────────────────────────────────────


@patch("pathlib.Path.exists", return_value=True)
@patch("app.pipeline.transcription.mutagen.File")
@patch("app.pipeline.transcription.aai.Transcriber")
def test_timestamps_converted_from_ms_to_seconds(
    mock_transcriber_cls: MagicMock,
    mock_mutagen_file: MagicMock,
    _mock_exists: MagicMock,
) -> None:
    """AssemblyAI millisecond timestamps must be divided by 1000 in the output."""
    _readable_audio(mock_mutagen_file)

    mock_transcriber_cls.return_value.transcribe.return_value = _make_transcript(
        aai.TranscriptStatus.completed,
        utterances=[_make_utterance("A", 1500, 3750, "Texte")],
    )

    result = transcribe_audio("/fake/session.webm")

    assert result[0]["start"] == pytest.approx(1.5)
    assert result[0]["end"] == pytest.approx(3.75)
