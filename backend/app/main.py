"""FastAPI application entry point.

Usage:
    uvicorn app.main:app --reload --port 8000
"""

import logging
import logging.config
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Attempt to create DB tables on startup; log a warning on failure.

    In production, use Alembic migrations instead of create_all.
    A missing or misconfigured database must not prevent the server from
    starting — endpoints that don't touch the DB (e.g. health check) should
    remain reachable so deployment probes don't fail before the DB is ready.
    """
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
