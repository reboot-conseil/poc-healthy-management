from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    # echo=True can be enabled temporarily for query debugging
    echo=False,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=10,
    pool_recycle=300,          # recycle before Postgres idle timeout closes them
    pool_timeout=5,            # fail fast instead of hanging indefinitely
    connect_args={"timeout": 5},  # asyncpg TCP connect timeout in seconds
)

# Session factory used by both FastAPI dependency injection and background tasks
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    """Shared declarative base — all SQLAlchemy models inherit from this."""


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a request-scoped async database session."""
    async with AsyncSessionLocal() as session:
        yield session
