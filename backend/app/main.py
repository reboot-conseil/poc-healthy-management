"""FastAPI application entry point.

Usage:
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import logging.config
import os
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import models so Base.metadata is populated before create_all
import app.models  # noqa: F401
from app.api import reports, scripts, sessions, tts
from app.config import settings
from app.db.database import Base, engine

logging.config.dictConfig(
    {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {
                "format": "%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
                "datefmt": "%H:%M:%S",
            }
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "default",
            }
        },
        "loggers": {
            # Show INFO+ for all app code
            "app": {"level": "INFO", "handlers": ["console"], "propagate": False},
        },
    }
)

logger = logging.getLogger(__name__)


_gcp_credentials_tmp: tempfile.NamedTemporaryFile | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Attempt to create DB tables on startup; log a warning on failure.

    In production, use Alembic migrations instead of create_all.
    A missing or misconfigured database must not prevent the server from
    starting — endpoints that don't touch the DB (e.g. health check) should
    remain reachable so deployment probes don't fail before the DB is ready.
    """
    global _gcp_credentials_tmp

    # When GOOGLE_APPLICATION_CREDENTIALS_JSON is set (Railway / any container
    # environment), write the JSON key to a temp file and point the Google SDK
    # at it via the standard GOOGLE_APPLICATION_CREDENTIALS env var.
    # This runs before the LLM singleton is built, so graph.py needs no changes.
    if settings.GOOGLE_APPLICATION_CREDENTIALS_JSON:
        _gcp_credentials_tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        )
        _gcp_credentials_tmp.write(settings.GOOGLE_APPLICATION_CREDENTIALS_JSON)
        _gcp_credentials_tmp.flush()
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = _gcp_credentials_tmp.name
        logger.info(
            "GCP credentials written to %s", _gcp_credentials_tmp.name
        )

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database tables verified / created.")
    except Exception as exc:
        logger.warning(
            "Could not connect to the database at startup: %s\n"
            "Check DATABASE_URL in your .env file and ensure PostgreSQL is running.",
            exc,
        )
    yield
    await engine.dispose()

    # Clean up the temp credentials file on shutdown.
    if _gcp_credentials_tmp is not None:
        try:
            os.unlink(_gcp_credentials_tmp.name)
        except OSError:
            pass


app = FastAPI(
    title="Workathon Transcription API",
    description="Audio capture, transcription (AssemblyAI) and LLM analysis for workathon sessions.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(reports.router)
app.include_router(scripts.router)
app.include_router(tts.router)
