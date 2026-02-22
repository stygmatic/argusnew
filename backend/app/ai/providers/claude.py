from __future__ import annotations

import json
import logging
from typing import Any

from app.ai.providers.base import AIMessage, AIProvider, AIResponse

logger = logging.getLogger(__name__)


class ClaudeProvider(AIProvider):
    """Anthropic Claude Messages API provider."""

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-5-20250929") -> None:
        self._api_key = api_key
        self._model = model

    async def complete(
        self,
        messages: list[AIMessage],
        *,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AIResponse:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=self._api_key)

        # Separate system prompt from messages
        system_prompt = ""
        api_messages: list[dict[str, str]] = []
        for msg in messages:
            if msg.role == "system":
                system_prompt += msg.content + "\n"
            else:
                api_messages.append({"role": msg.role, "content": msg.content})

        kwargs: dict[str, Any] = {
            "model": self._model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": api_messages,
        }
        if system_prompt.strip():
            kwargs["system"] = system_prompt.strip()

        response = await client.messages.create(**kwargs)
        content = response.content[0].text if response.content else ""
        return AIResponse(
            content=content,
            model=response.model,
            usage={
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
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
        schema_instruction = (
            "\n\nYou MUST respond with valid JSON conforming to this schema:\n"
            f"```json\n{json.dumps(schema, indent=2)}\n```\n"
            "Respond ONLY with the JSON object, no other text."
        )
        augmented = list(messages)
        if augmented and augmented[-1].role == "user":
            augmented[-1] = AIMessage(
                role="user",
                content=augmented[-1].content + schema_instruction,
            )
        else:
            augmented.append(AIMessage(role="user", content=schema_instruction))

        return await self.complete(
            augmented, temperature=temperature, max_tokens=max_tokens
        )
