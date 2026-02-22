from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter

from app.ai.mission_planner import MissionIntent, mission_planner
from app.ai.prompts.command_execution import COMMAND_EXECUTION_SCHEMA, COMMAND_EXECUTION_SYSTEM
from app.ai.suggestions import suggestion_service
from app.config import settings
from app.mqtt.client import mqtt_client
from app.services.command_service import command_service
from app.services.state_manager import state_manager
from app.ws.manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/suggestions")
async def list_suggestions(robot_id: str | None = None) -> dict[str, Any]:
    pending = suggestion_service.get_pending(robot_id)
    return {"suggestions": [s.to_dict() for s in pending]}


@router.get("/suggestions/all")
async def list_all_suggestions(limit: int = 50) -> dict[str, Any]:
    items = suggestion_service.get_all(limit)
    return {"suggestions": [s.to_dict() for s in items]}


@router.post("/suggestions/{suggestion_id}/approve")
async def approve_suggestion(suggestion_id: str) -> dict[str, Any]:
    suggestion = suggestion_service.approve(suggestion_id)
    if suggestion is None:
        return {"error": "Suggestion not found or not pending"}

    # Execute the proposed action if present
    if suggestion.proposed_action:
        robot_id = suggestion.proposed_action.get("robotId", suggestion.robot_id)
        command_type = suggestion.proposed_action.get("commandType", "")
        parameters = suggestion.proposed_action.get("parameters", {})

        robot = state_manager.robots.get(robot_id) if robot_id else None
        if robot_id and command_type and robot:
            import time

            robot.last_command_source = "ai"
            robot.last_command_at = time.time()

            cmd = command_service.create_command(
                robot_id=robot_id,
                command_type=command_type,
                parameters=parameters,
                source="ai",
            )
            await mqtt_client.publish(
                f"argus/{robot_id}/command/execute",
                {
                    "command_id": cmd.id,
                    "command_type": command_type,
                    "parameters": parameters,
                },
            )
            command_service.update_status(cmd.id, "sent")
            logger.info("AI suggestion approved: %s -> %s (%s)", command_type, robot_id, cmd.id)

    # Broadcast update
    await ws_manager.broadcast({
        "type": "ai.suggestion",
        "payload": suggestion.to_dict(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return suggestion.to_dict()


@router.post("/suggestions/{suggestion_id}/reject")
async def reject_suggestion(suggestion_id: str) -> dict[str, Any]:
    suggestion = suggestion_service.reject(suggestion_id)
    if suggestion is None:
        return {"error": "Suggestion not found or not pending"}

    await ws_manager.broadcast({
        "type": "ai.suggestion",
        "payload": suggestion.to_dict(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return suggestion.to_dict()


@router.post("/execute")
async def execute_ai_command(body: dict[str, Any]) -> dict[str, Any]:
    """Interpret a natural language instruction and dispatch robot commands."""
    if not settings.ai_enabled:
        return {"error": "AI is not enabled. Set AI_ENABLED=true."}

    objective = body.get("objective", "")
    selected_robots = body.get("selectedRobots")
    source = body.get("source", "ai")

    if not objective:
        return {"error": "objective is required"}

    # Build fleet context
    robots = state_manager.robots
    if selected_robots:
        available = {rid: r for rid, r in robots.items() if rid in selected_robots}
    else:
        available = {rid: r for rid, r in robots.items() if r.status not in ("offline", "error")}

    robot_lines = []
    for rid, r in available.items():
        robot_lines.append(
            f"  - {r.name} ({rid}): type={r.robot_type}, status={r.status}, "
            f"battery={r.battery_percent:.0f}%, position=({r.latitude:.5f}, {r.longitude:.5f}), "
            f"alt={r.altitude:.1f}m"
        )

    user_message = (
        f"INSTRUCTION: {objective}\n\n"
        f"AVAILABLE ROBOTS:\n" + "\n".join(robot_lines)
    )

    try:
        from app.ai.providers import get_ai_provider
        from app.ai.providers.base import AIMessage

        provider = get_ai_provider()
        messages = [
            AIMessage(role="system", content=COMMAND_EXECUTION_SYSTEM),
            AIMessage(role="user", content=user_message),
        ]
        response = await provider.complete_structured(
            messages, COMMAND_EXECUTION_SCHEMA, temperature=0.2, max_tokens=2048
        )

        text = response.content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        result = json.loads(text)
        commands_out = []

        for cmd_spec in result.get("commands", []):
            robot_id = cmd_spec.get("robotId", "")
            command_type = cmd_spec.get("commandType", "")
            # Strip null values from parameters (OpenAI strict mode emits all fields)
            parameters = {k: v for k, v in cmd_spec.get("parameters", {}).items() if v is not None}

            robot = state_manager.robots.get(robot_id)
            if not robot or not command_type:
                continue

            robot.last_command_source = source
            robot.last_command_at = time.time()

            cmd = command_service.create_command(
                robot_id=robot_id,
                command_type=command_type,
                parameters=parameters,
                source=source,
            )
            await mqtt_client.publish(
                f"argus/{robot_id}/command/execute",
                {
                    "command_id": cmd.id,
                    "command_type": command_type,
                    "parameters": parameters,
                },
            )
            command_service.update_status(cmd.id, "sent")

            await ws_manager.broadcast({
                "type": "command.status",
                "payload": cmd.to_dict(),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

            commands_out.append(cmd.to_dict())
            logger.info("AI execute: %s -> %s (%s)", command_type, robot_id, cmd.id)

        return {
            "commands": commands_out,
            "explanation": result.get("explanation", ""),
        }
    except Exception as e:
        logger.exception("AI command execution failed")
        return {"error": str(e)}


@router.post("/missions/plan")
async def generate_mission_plan(body: dict[str, Any]) -> dict[str, Any]:
    if not settings.ai_enabled:
        return {"error": "AI is not enabled. Set AI_ENABLED=true."}

    intent = MissionIntent(
        objective=body.get("objective", ""),
        zone=body.get("zone"),
        constraints=body.get("constraints", []),
        rules_of_engagement=body.get("rulesOfEngagement", []),
        preferences=body.get("preferences", {}),
        selected_robots=body.get("selectedRobots"),
    )

    if not intent.objective:
        return {"error": "objective is required"}

    try:
        plan = await mission_planner.generate_plan(intent)
        return {"plan": plan}
    except Exception as e:
        logger.exception("Mission planning failed")
        return {"error": str(e)}


@router.post("/missions/plan/approve")
async def approve_mission_plan(body: dict[str, Any]) -> dict[str, Any]:
    """Convert an approved AI plan into a live mission."""
    from app.services.mission_service import mission_service

    plan = body.get("plan", {})
    name = plan.get("name", "AI Mission")
    assignments = plan.get("assignments", [])

    assigned_robots = [a["robotId"] for a in assignments]
    waypoints: dict[str, list[dict[str, Any]]] = {}
    for assignment in assignments:
        robot_id = assignment["robotId"]
        waypoints[robot_id] = [
            {
                "latitude": wp["latitude"],
                "longitude": wp["longitude"],
                "altitude": wp.get("altitude", 0),
                "action": wp.get("action", "navigate"),
            }
            for wp in assignment.get("waypoints", [])
        ]

    mission = mission_service.create_mission(name, assigned_robots, waypoints)
    mission_service.update_status(mission.id, "active")

    # Dispatch follow_waypoints commands to each assigned robot
    for robot_id, wps in waypoints.items():
        robot = state_manager.robots.get(robot_id)
        if not robot or not wps:
            continue

        robot.last_command_source = "ai"
        robot.last_command_at = time.time()

        cmd = command_service.create_command(
            robot_id=robot_id,
            command_type="follow_waypoints",
            parameters={"waypoints": wps},
            source="ai",
        )
        await mqtt_client.publish(
            f"argus/{robot_id}/command/execute",
            {
                "command_id": cmd.id,
                "command_type": "follow_waypoints",
                "parameters": {"waypoints": wps},
            },
        )
        command_service.update_status(cmd.id, "sent")
        logger.info("Mission plan dispatched: follow_waypoints -> %s (%s)", robot_id, cmd.id)

    await ws_manager.broadcast({
        "type": "mission.updated",
        "payload": mission.to_dict(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return mission.to_dict()
