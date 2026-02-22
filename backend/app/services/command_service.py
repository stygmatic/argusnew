from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Command:
    id: str
    robot_id: str
    command_type: str  # goto, stop, return_home, patrol, set_speed
    parameters: dict[str, Any] = field(default_factory=dict)
    source: str = "operator"  # operator | ai | voice
    status: str = "pending"  # pending | sent | acknowledged | completed | failed
    created_at: float = 0.0
    updated_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "robotId": self.robot_id,
            "commandType": self.command_type,
            "parameters": self.parameters,
            "source": self.source,
            "status": self.status,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


class CommandService:
    def __init__(self) -> None:
        self.commands: dict[str, Command] = {}
        self.robot_commands: dict[str, list[str]] = {}  # robot_id -> [command_ids]

    def create_command(
        self,
        robot_id: str,
        command_type: str,
        parameters: dict[str, Any] | None = None,
        source: str = "operator",
    ) -> Command:
        cmd = Command(
            id=str(uuid.uuid4())[:8],
            robot_id=robot_id,
            command_type=command_type,
            parameters=parameters or {},
            source=source,
            status="pending",
            created_at=time.time(),
            updated_at=time.time(),
        )
        self.commands[cmd.id] = cmd
        self.robot_commands.setdefault(robot_id, []).append(cmd.id)
        return cmd

    def update_status(self, command_id: str, status: str) -> Command | None:
        cmd = self.commands.get(command_id)
        if cmd is None:
            return None
        cmd.status = status
        cmd.updated_at = time.time()
        return cmd

    def get_robot_commands(self, robot_id: str, limit: int = 20) -> list[Command]:
        cmd_ids = self.robot_commands.get(robot_id, [])
        return [self.commands[cid] for cid in cmd_ids[-limit:] if cid in self.commands]

    def get_active_command(self, robot_id: str) -> Command | None:
        """Get the most recent non-terminal command for a robot."""
        cmd_ids = self.robot_commands.get(robot_id, [])
        for cid in reversed(cmd_ids):
            cmd = self.commands.get(cid)
            if cmd and cmd.status in ("pending", "sent", "acknowledged"):
                return cmd
        return None


command_service = CommandService()
