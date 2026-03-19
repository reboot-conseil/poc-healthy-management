# Import all models here so SQLAlchemy metadata is populated before create_all / Alembic autogenerate
from app.models.report import Report  # noqa: F401
from app.models.script import Script  # noqa: F401
from app.models.session import Session  # noqa: F401
from app.models.utterance import Utterance  # noqa: F401

__all__ = ["Session", "Script", "Utterance"]
