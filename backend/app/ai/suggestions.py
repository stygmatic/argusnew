from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Suggestion:
    id: str
    robot_id: str
    title: str
    description: str
    reasoning: str
    severity: str = "info"  # info | warning | critical
    proposed_action: dict[str, Any] | None = None
    confidence: float = 0.0
    status: str = "pending"  # pending | approved | rejected | expired
    source: str = "heuristic"  # heuristic | ai
    created_at: float = 0.0
    expires_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "robotId": self.robot_id,
            "title": self.title,
            "description": self.description,
            "reasoning": self.reasoning,
            "severity": self.severity,
            "proposedAction": self.proposed_action,
            "confidence": self.confidence,
            "status": self.status,
            "source": self.source,
            "createdAt": self.created_at,
            "expiresAt": self.expires_at,
        }

    @property
    def is_expired(self) -> bool:
        return self.expires_at > 0 and time.time() > self.expires_at


class SuggestionService:
    MAX_SUGGESTIONS = 50

    def __init__(self) -> None:
        self.suggestions: dict[str, Suggestion] = {}

    def add(self, suggestion: Suggestion) -> Suggestion:
        self.suggestions[suggestion.id] = suggestion
        self._cleanup()
        return suggestion

    def _cleanup(self) -> None:
        """Expire old suggestions and cap total count."""
        now = time.time()
        for s in list(self.suggestions.values()):
            if s.status == "pending" and s.expires_at > 0 and now > s.expires_at:
                s.status = "expired"
        # Remove resolved suggestions beyond limit
        if len(self.suggestions) > self.MAX_SUGGESTIONS:
            by_time = sorted(self.suggestions.values(), key=lambda s: s.created_at)
            to_remove = len(self.suggestions) - self.MAX_SUGGESTIONS
            removed = 0
            for s in by_time:
                if removed >= to_remove:
                    break
                if s.status in ("expired", "rejected", "approved"):
                    del self.suggestions[s.id]
                    removed += 1

    def has_pending_for(self, robot_id: str, title: str) -> bool:
        """Check if a pending suggestion with same robot+title already exists."""
        now = time.time()
        for s in self.suggestions.values():
            if (
                s.robot_id == robot_id
                and s.title == title
                and s.status == "pending"
                and (s.expires_at == 0 or now < s.expires_at)
            ):
                return True
        return False

    def create(
        self,
        robot_id: str,
        title: str,
        description: str,
        reasoning: str,
        severity: str = "info",
        proposed_action: dict[str, Any] | None = None,
        confidence: float = 0.8,
        source: str = "heuristic",
        ttl_seconds: float = 300,
    ) -> Suggestion | None:
        # Skip if duplicate pending suggestion exists
        if self.has_pending_for(robot_id, title):
            return None

        now = time.time()
        suggestion = Suggestion(
            id=str(uuid.uuid4())[:8],
            robot_id=robot_id,
            title=title,
            description=description,
            reasoning=reasoning,
            severity=severity,
            proposed_action=proposed_action,
            confidence=confidence,
            source=source,
            created_at=now,
            expires_at=now + ttl_seconds if ttl_seconds > 0 else 0,
        )
        return self.add(suggestion)

    def approve(self, suggestion_id: str) -> Suggestion | None:
        s = self.suggestions.get(suggestion_id)
        if s and s.status == "pending":
            s.status = "approved"
            return s
        return None

    def reject(self, suggestion_id: str) -> Suggestion | None:
        s = self.suggestions.get(suggestion_id)
        if s and s.status == "pending":
            s.status = "rejected"
            return s
        return None

    def get_pending(self, robot_id: str | None = None) -> list[Suggestion]:
        now = time.time()
        result = []
        for s in self.suggestions.values():
            if s.status != "pending":
                continue
            if s.expires_at > 0 and now > s.expires_at:
                s.status = "expired"
                continue
            if robot_id and s.robot_id != robot_id:
                continue
            result.append(s)
        return result

    def get_all(self, limit: int = 50) -> list[Suggestion]:
        items = sorted(self.suggestions.values(), key=lambda s: s.created_at, reverse=True)
        return items[:limit]


suggestion_service = SuggestionService()
