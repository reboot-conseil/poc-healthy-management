"""Shared fixtures for the backend test suite."""

import pytest


@pytest.fixture(autouse=True)
def patch_settings(monkeypatch):
    """Ensure config.settings has safe defaults for every test.

    pydantic-settings loads settings at import time, so we patch the already-
    instantiated settings object rather than environment variables.
    """
    import app.pipeline.transcription as transcription_module

    monkeypatch.setattr(transcription_module.settings, "ASSEMBLYAI_API_KEY", "test_key")
