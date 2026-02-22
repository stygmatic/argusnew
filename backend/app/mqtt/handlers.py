from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from app.ai.analysis_service import analysis_service
from app.db.repositories.command_repo import command_repo
from app.db.repositories.telemetry_repo import telemetry_repo
from app.services.command_service import command_service
from app.services.state_manager import state_manager
from app.ws.manager import ws_manager

logger = logging.getLogger(__name__)


async def handle_telemetry(topic: str, payload: dict[str, Any]) -> None:
    """Handle telemetry messages from robots."""
    parts = topic.split("/")
    if len(parts) < 4:
        return

    robot_id = parts[1]
    subcategory = parts[3]  # position, health, sensors

    if subcategory == "position":
        robot = state_manager.update_position(robot_id, payload)
        # Enqueue for database persistence
        telemetry_repo.enqueue(robot_id, position=payload)
    elif subcategory == "health":
        robot = state_manager.update_health(robot_id, payload)
        telemetry_repo.enqueue(robot_id, health=payload)
    else:
        return

    if robot is not None:
        await ws_manager.broadcast(
            {
                "type": "robot.updated",
                "payload": robot.to_dict(),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        # Run heuristic analysis on telemetry updates
        asyncio.create_task(analysis_service.on_telemetry(robot))


async def handle_status(topic: str, payload: dict[str, Any]) -> None:
    """Handle status messages from robots (online/offline/error)."""
    parts = topic.split("/")
    if len(parts) < 3:
        return

    robot_id = parts[1]
    robot = state_manager.update_status(robot_id, payload)

    if robot is not None:
        await ws_manager.broadcast(
            {
                "type": "robot.updated",
                "payload": robot.to_dict(),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )


async def handle_command_ack(topic: str, payload: dict[str, Any]) -> None:
    """Handle command acknowledgements from robots."""
    parts = topic.split("/")
    if len(parts) < 4:
        return

    robot_id = parts[1]
    command_id = payload.get("command_id", "")
    status = payload.get("status", "acknowledged")

    logger.info("Command ACK from %s: cmd=%s status=%s", robot_id, command_id, status)

    cmd = command_service.update_status(command_id, status)
    if cmd is not None:
        # Persist status update to database (fire-and-forget)
        asyncio.create_task(command_repo.update_status(command_id, status))

        await ws_manager.broadcast(
            {
                "type": "command.status",
                "payload": cmd.to_dict(),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

    # Update robot status based on command status
    if status == "completed":
        robot = state_manager.robots.get(robot_id)
        if robot and robot.status not in ("error", "offline"):
            robot.status = "active"
            await ws_manager.broadcast(
                {
                    "type": "robot.updated",
                    "payload": robot.to_dict(),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )
