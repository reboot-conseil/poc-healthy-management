# Import all models here so SQLAlchemy metadata is populated before create_all / Alembic autogenerate
from app.models.session import Session  # noqa: F401
from app.models.utterance import Utterance  # noqa: F401

__all__ = ["Session", "Utterance"]
