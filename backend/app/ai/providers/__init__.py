from __future__ import annotations

from app.ai.providers.base import AIProvider
from app.config import settings


def get_ai_provider() -> AIProvider:
    """Factory: return the configured AI provider instance."""
    provider = settings.ai_provider.lower()

    if provider == "anthropic":
        from app.ai.providers.claude import ClaudeProvider

        return ClaudeProvider(
            api_key=settings.anthropic_api_key,
            model=settings.ai_model,
        )
    elif provider == "openai":
        from app.ai.providers.openai import OpenAIProvider

        return OpenAIProvider(
            api_key=settings.openai_api_key,
            model=settings.ai_model,
        )
    elif provider == "ollama":
        from app.ai.providers.ollama import OllamaProvider

        return OllamaProvider(
            base_url=settings.ollama_base_url,
            model=settings.ai_model,
        )
    else:
        raise ValueError(f"Unknown AI provider: {provider}")
