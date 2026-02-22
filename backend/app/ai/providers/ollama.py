from __future__ import annotations

import logging

import httpx

from app.ai.providers.base import AIMessage, AIProvider, AIResponse

logger = logging.getLogger(__name__)


class OllamaProvider(AIProvider):
    """Ollama local model provider via HTTP API."""

    def __init__(self, base_url: str = "http://localhost:11434", model: str = "llama3") -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model

    async def complete(
        self,
        messages: list[AIMessage],
        *,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AIResponse:
        api_messages = [{"role": m.role, "content": m.content} for m in messages]

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{self._base_url}/api/chat",
                json={
                    "model": self._model,
                    "messages": api_messages,
                    "stream": False,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens,
                    },
                },
            )
            resp.raise_for_status()
            data = resp.json()

        content = data.get("message", {}).get("content", "")
        return AIResponse(
            content=content,
            model=self._model,
            usage={
                "input_tokens": data.get("prompt_eval_count", 0),
                "output_tokens": data.get("eval_count", 0),
            },
        )
