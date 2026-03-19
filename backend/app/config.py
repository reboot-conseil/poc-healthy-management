from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables or a .env file.

    All fields without defaults are required in production. Defaults are
    intentionally permissive so the test suite can run without a real .env.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # AssemblyAI — mandatory in production
    ASSEMBLYAI_API_KEY: str = ""

    # Comma-separated priority list of AssemblyAI speech models.
    # The system uses the first model that supports the detected language and
    # falls back to the next one automatically (e.g. U3 Pro for FR/EN/ES/PT/DE/IT,
    # Universal-2 for all other languages).
    # Options: universal-3-pro, universal-2
    ASSEMBLYAI_SPEECH_MODELS: str = "universal-3-pro,universal-2"

    @property
    def assemblyai_speech_models_list(self) -> list[str]:
        return [
            m.strip() for m in self.ASSEMBLYAI_SPEECH_MODELS.split(",") if m.strip()
        ]

    # PostgreSQL — async DSN (asyncpg driver)
    DATABASE_URL: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/workathon"
    )

    # LLM — Vertex AI via ChatGoogleGenerativeAI (langchain-google-genai v4+)
    # Authentication uses Application Default Credentials (ADC).
    # Local dev:  gcloud auth application-default login
    # Production: set GOOGLE_APPLICATION_CREDENTIALS_JSON to the full contents of
    #             a GCP service account JSON key (with roles/aiplatform.user).
    #             main.py lifespan writes it to /tmp and sets GOOGLE_APPLICATION_CREDENTIALS.
    GOOGLE_CLOUD_PROJECT: str = ""  # GCP project ID — triggers Vertex AI backend
    GOOGLE_CLOUD_LOCATION: str = "us-central1"  # Vertex AI region
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # Full JSON content of a GCP service account key file.
    # Leave empty locally (ADC via gcloud is used instead).
    # On Railway: paste the entire service account JSON as this env var value.
    GOOGLE_APPLICATION_CREDENTIALS_JSON: str = ""

    # Number of utterances sent to the LLM in a single analysis call.
    # Lower values = more context precision; higher values = fewer API calls (faster).
    ANALYSIS_BATCH_SIZE: int = 10

    # CORS — comma-separated list of allowed origins
    ALLOWED_ORIGINS: str = "http://localhost:5173"

    # Directory where uploaded audio files are stored (relative to process cwd)
    UPLOAD_DIR: str = "uploads"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]


settings = Settings()
