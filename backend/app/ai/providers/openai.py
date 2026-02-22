from __future__ import annotations

import logging
from typing import Any

from app.ai.providers.base import AIMessage, AIProvider, AIResponse

logger = logging.getLogger(__name__)


class OpenAIProvider(AIProvider):
    """OpenAI Chat Completions provider."""

    def __init__(self, api_key: str, model: str = "gpt-4o") -> None:
        self._api_key = api_key
        self._model = model

    async def complete(
        self,
        messages: list[AIMessage],
        *,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AIResponse:
        import openai

        client = openai.AsyncOpenAI(api_key=self._api_key)
        api_messages = [{"role": m.role, "content": m.content} for m in messages]

        response = await client.chat.completions.create(
            model=self._model,
            messages=api_messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        choice = response.choices[0]
        return AIResponse(
            content=choice.message.content or "",
            model=response.model or self._model,
            usage={
                "input_tokens": response.usage.prompt_tokens if response.usage else 0,
                "output_tokens": response.usage.completion_tokens if response.usage else 0,
            },
        )

    async def complete_structured(
        self,
        messages: list[AIMessage],
        schema: dict[str, Any],
        *,
        temperature: float = 0.1,
        max_tokens: int = 4096,
    ) -> AIResponse:
        import openai

        client = openai.AsyncOpenAI(api_key=self._api_key)
        api_messages = [{"role": m.role, "content": m.content} for m in messages]

        response = await client.chat.completions.create(
            model=self._model,
            messages=api_messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "structured_output",
                    "schema": schema,
                    "strict": True,
                },
            },
        )
        choice = response.choices[0]
        return AIResponse(
            content=choice.message.content or "",
            model=response.model or self._model,
            usage={
                "input_tokens": response.usage.prompt_tokens if response.usage else 0,
                "output_tokens": response.usage.completion_tokens if response.usage else 0,
            },
        )
