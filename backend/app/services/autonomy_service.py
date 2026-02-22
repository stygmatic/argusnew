from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any

from app.services.state_manager import AUTONOMY_TIERS, state_manager

HIGH_RISK_COMMANDS = {"goto", "return_home", "take_off", "land", "dive", "surface"}
LOW_RISK_COMMANDS = {"set_speed", "patrol", "hold_position", "hold_depth", "stop"}

SUPERVISED_COUNTDOWN_SECONDS = 10


@dataclass
class AutonomyChangeEntry:
    id: str
    robot_id: str  # "__fleet__" for fleet-wide changes
    old_tier: str
    new_tier: str
    changed_by: str = "operator"
    timestamp: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "robotId": self.robot_id,
            "oldTier": self.old_tier,
            "newTier": self.new_tier,
            "changedBy": self.changed_by,
            "timestamp": self.timestamp,
        }


def is_high_risk(command_type: str) -> bool:
    return command_type in HIGH_RISK_COMMANDS


class AutonomyService:
    def __init__(self) -> None:
        from app.config import settings

        self.fleet_default: str = settings.default_autonomy_tier
        self.change_log: list[AutonomyChangeEntry] = []

    def set_robot_tier(self, robot_id: str, tier: str) -> AutonomyChangeEntry | None:
        if tier not in AUTONOMY_TIERS:
            return None
        robot = state_manager.robots.get(robot_id)
        if robot is None:
            return None
        old_tier = robot.autonomy_tier
        if old_tier == tier:
            return None
        robot.autonomy_tier = tier
        entry = AutonomyChangeEntry(
            id=str(uuid.uuid4())[:8],
            robot_id=robot_id,
            old_tier=old_tier,
            new_tier=tier,
            changed_by="operator",
            timestamp=time.time(),
        )
        self.change_log.append(entry)
        return entry

    def set_fleet_default(self, tier: str) -> AutonomyChangeEntry | None:
        if tier not in AUTONOMY_TIERS:
            return None
        old_tier = self.fleet_default
        if old_tier == tier:
            return None
        self.fleet_default = tier
        entry = AutonomyChangeEntry(
            id=str(uuid.uuid4())[:8],
            robot_id="__fleet__",
            old_tier=old_tier,
            new_tier=tier,
            changed_by="operator",
            timestamp=time.time(),
        )
        self.change_log.append(entry)
        return entry

    def get_change_log(
        self, robot_id: str | None = None, limit: int = 50
    ) -> list[AutonomyChangeEntry]:
        entries = self.change_log
        if robot_id:
            entries = [e for e in entries if e.robot_id == robot_id]
        return entries[-limit:]

    def should_auto_execute(
        self, robot_id: str, proposed_action: dict[str, Any] | None
    ) -> tuple[bool, int]:
        """Returns (should_execute, countdown_seconds)."""
        robot = state_manager.robots.get(robot_id)
        if robot is None or proposed_action is None:
            return False, 0

        tier = robot.autonomy_tier
        command_type = proposed_action.get("commandType", "")

        if tier in ("manual", "assisted"):
            return False, 0
        elif tier == "supervised":
            if is_high_risk(command_type):
                return False, 0
            return True, SUPERVISED_COUNTDOWN_SECONDS
        elif tier == "autonomous":
            return True, 0

        return False, 0

    def get_tiers_summary(self) -> dict[str, Any]:
        robot_tiers = {
            rid: r.autonomy_tier for rid, r in state_manager.robots.items()
        }
        return {
            "fleetDefault": self.fleet_default,
            "robots": robot_tiers,
        }


autonomy_service = AutonomyService()
