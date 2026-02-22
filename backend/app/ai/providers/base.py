from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AIMessage:
    role: str  # system | user | assistant
    content: str


@dataclass
class AIResponse:
    content: str
    model: str = ""
    usage: dict[str, int] = field(default_factory=dict)


class AIProvider(ABC):
    """Abstract base class for AI provider integrations."""

    @abstractmethod
    async def complete(
        self,
        messages: list[AIMessage],
        *,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AIResponse:
        """Send a chat completion request and return the response."""

    async def complete_structured(
        self,
        messages: list[AIMessage],
        schema: dict[str, Any],
        *,
        temperature: float = 0.1,
        max_tokens: int = 4096,
    ) -> AIResponse:
        """Request structured JSON output conforming to a schema.

        Default implementation appends schema instructions to the last message.
        Providers may override for native structured output support.
        """
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
