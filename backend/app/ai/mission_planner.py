from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from app.ai.prompts.mission_planning import MISSION_PLANNING_SYSTEM, MISSION_PLAN_SCHEMA
from app.ai.providers.base import AIMessage
from app.config import settings
from app.services.state_manager import state_manager

logger = logging.getLogger(__name__)


@dataclass
class MissionIntent:
    objective: str
    zone: dict[str, Any] | None = None  # GeoJSON polygon or bounding box
    constraints: list[str] = field(default_factory=list)
    rules_of_engagement: list[str] = field(default_factory=list)
    preferences: dict[str, Any] = field(default_factory=dict)
    selected_robots: list[str] | None = None  # None = auto-select


class MissionPlanner:
    """Generates AI-driven mission plans from operator intent."""

    async def generate_plan(self, intent: MissionIntent) -> dict[str, Any]:
        if not settings.ai_enabled:
            raise RuntimeError("AI is not enabled")

        from app.ai.providers import get_ai_provider

        provider = get_ai_provider()
        context = self._build_context(intent)

        messages = [
            AIMessage(role="system", content=MISSION_PLANNING_SYSTEM),
            AIMessage(role="user", content=context),
        ]

        response = await provider.complete_structured(
            messages, MISSION_PLAN_SCHEMA, temperature=0.2, max_tokens=4096
        )

        return self._parse_plan(response.content)

    def _build_context(self, intent: MissionIntent) -> str:
        # Gather available robots
        robots = state_manager.robots
        if intent.selected_robots:
            available = {rid: r for rid, r in robots.items() if rid in intent.selected_robots}
        else:
            available = {rid: r for rid, r in robots.items() if r.status not in ("offline", "error")}

        robot_summaries = []
        for rid, r in available.items():
            robot_summaries.append(
                f"  - {r.name} ({rid}): type={r.robot_type}, status={r.status}, "
                f"battery={r.battery_percent:.0f}%, position=({r.latitude:.5f}, {r.longitude:.5f}), "
                f"alt={r.altitude:.1f}m"
            )

        parts = [
            f"OBJECTIVE: {intent.objective}",
            "",
            "AVAILABLE ROBOTS:",
            *robot_summaries,
        ]

        if intent.zone:
            parts.extend(["", f"ZONE: {json.dumps(intent.zone)}"])

        if intent.constraints:
            parts.extend(["", "CONSTRAINTS:"])
            parts.extend(f"  - {c}" for c in intent.constraints)

        if intent.rules_of_engagement:
            parts.extend(["", "RULES OF ENGAGEMENT:"])
            parts.extend(f"  - {r}" for r in intent.rules_of_engagement)

        if intent.preferences:
            parts.extend(["", f"PREFERENCES: {json.dumps(intent.preferences)}"])

        return "\n".join(parts)

    def _parse_plan(self, content: str) -> dict[str, Any]:
        text = content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        return json.loads(text)


mission_planner = MissionPlanner()
