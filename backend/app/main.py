from __future__ import annotations

import asyncio
import json as _json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncGenerator

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.ai.analysis_service import analysis_service
from app.api.router import api_router
from app.config import settings
from app.middleware.rate_limit import RateLimitMiddleware
from app.db.connection import db
from app.db.repositories.command_repo import command_repo
from app.db.repositories.telemetry_repo import telemetry_repo
from app.mqtt.client import mqtt_client
from app.mqtt.handlers import handle_command_ack, handle_status, handle_telemetry
from app.services.autonomy_service import autonomy_service
from app.services.command_service import command_service
from app.services.state_manager import AUTONOMY_TIERS, state_manager
from app.ws.manager import ws_manager


class _JSONFormatter(logging.Formatter):
    """Structured JSON log formatter for production."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "ts": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info and record.exc_info[1]:
            log_entry["exc"] = self.formatException(record.exc_info)
        return _json.dumps(log_entry)


def _setup_logging() -> None:
    root = logging.getLogger()
    root.setLevel(logging.DEBUG if settings.debug else logging.INFO)
    handler = logging.StreamHandler()
    if settings.debug:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    else:
        handler.setFormatter(_JSONFormatter())
    root.addHandler(handler)


_setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    # Startup
    logger.info("Starting Argus Ground Station")
    await db.connect()
    await telemetry_repo.start()
    mqtt_client.on("telemetry", handle_telemetry)
    mqtt_client.on("status", handle_status)
    mqtt_client.on("command", handle_command_ack)
    await mqtt_client.start()
    await analysis_service.start()
    yield
    # Shutdown
    logger.info("Shutting down Argus Ground Station")
    await analysis_service.stop()
    await mqtt_client.stop()
    await telemetry_repo.stop()
    await db.disconnect()


async def handle_ws_message(websocket: WebSocket, data: dict[str, Any]) -> None:
    """Process incoming WebSocket messages from the frontend."""
    msg_type = data.get("type", "")
    payload = data.get("payload", {})

    if msg_type == "command.send":
        robot_id = payload.get("robotId", "")
        command_type = payload.get("commandType", "")
        parameters = payload.get("parameters", {})

        if not robot_id or not command_type:
            return

        # Check robot exists
        robot = state_manager.robots.get(robot_id)
        if robot is None:
            return

        # Create command record
        cmd = command_service.create_command(
            robot_id=robot_id,
            command_type=command_type,
            parameters=parameters,
            source="operator",
        )

        # Publish to MQTT for the robot
        await mqtt_client.publish(
            f"argus/{robot_id}/command/execute",
            {
                "command_id": cmd.id,
                "command_type": command_type,
                "parameters": parameters,
            },
        )

        # Track operator authority
        import time as _time

        robot.last_command_source = "operator"
        robot.last_command_at = _time.time()

        # Update command status to sent
        command_service.update_status(cmd.id, "sent")

        # Persist command to database (fire-and-forget)
        asyncio.create_task(
            command_repo.insert(
                cmd.id, robot_id, command_type, parameters, "operator", "sent"
            )
        )

        # Broadcast command status to all clients
        await ws_manager.broadcast(
            {
                "type": "command.status",
                "payload": cmd.to_dict(),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

        logger.info("Command dispatched: %s -> %s (%s)", command_type, robot_id, cmd.id)

    elif msg_type == "autonomy.set_tier":
        robot_id = payload.get("robotId", "")
        tier = payload.get("tier", "")

        if tier not in AUTONOMY_TIERS:
            return

        if robot_id == "__fleet__":
            entry = autonomy_service.set_fleet_default(tier)
        else:
            entry = autonomy_service.set_robot_tier(robot_id, tier)

        if entry:
            await ws_manager.broadcast({
                "type": "autonomy.changed",
                "payload": entry.to_dict(),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            logger.info("Autonomy tier changed: %s -> %s", entry.robot_id, entry.new_tier)


def create_app() -> FastAPI:
    app = FastAPI(title="Argus Ground Station", version="0.3.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if not settings.debug:
        app.add_middleware(RateLimitMiddleware)

    app.include_router(api_router)

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await ws_manager.connect(websocket)
        # Send full state snapshot on connect
        await ws_manager.send_to(
            websocket,
            {
                "type": "state.sync",
                "payload": state_manager.get_full_state(),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
        try:
            while True:
                data = await websocket.receive_json()
                logger.debug("WS message from client: %s", data.get("type"))
                await handle_ws_message(websocket, data)
        except WebSocketDisconnect:
            ws_manager.disconnect(websocket)

    return app


app = create_app()
