from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mqtt_broker: str = "localhost"
    mqtt_port: int = 1883
    mqtt_user: str = ""
    mqtt_password: str = ""
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    debug: bool = False
    database_url: str = "postgresql://postgres:argus_dev@localhost:5432/argus"

    # AI settings
    ai_enabled: bool = False
    ai_provider: str = "anthropic"  # anthropic | openai | ollama
    ai_model: str = "claude-sonnet-4-5-20250929"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"

    # Autonomy settings
    default_autonomy_tier: str = "assisted"

    # Voice integration
    voice_api_key: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
