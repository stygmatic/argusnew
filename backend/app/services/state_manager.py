from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any


AUTONOMY_TIERS = ("manual", "assisted", "supervised", "autonomous")


@dataclass
class RobotState:
    id: str
    name: str = ""
    robot_type: str = "drone"
    status: str = "offline"
    latitude: float = 0.0
    longitude: float = 0.0
    altitude: float = 0.0
    heading: float = 0.0
    speed: float = 0.0
    battery_percent: float = 100.0
    signal_strength: float = 100.0
    last_seen: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)
    autonomy_tier: str = "assisted"
    last_command_source: str = ""
    last_command_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "robotType": self.robot_type,
            "status": self.status,
            "position": {
                "latitude": self.latitude,
                "longitude": self.longitude,
                "altitude": self.altitude,
                "heading": self.heading,
            },
            "speed": self.speed,
            "health": {
                "batteryPercent": self.battery_percent,
                "signalStrength": self.signal_strength,
            },
            "lastSeen": self.last_seen,
            "metadata": self.metadata,
            "autonomyTier": self.autonomy_tier,
            "lastCommandSource": self.last_command_source,
            "lastCommandAt": self.last_command_at,
        }


class StateManager:
    def __init__(self) -> None:
        self.robots: dict[str, RobotState] = {}

    def register_robot(self, robot_id: str, data: dict[str, Any]) -> RobotState:
        robot = RobotState(
            id=robot_id,
            name=data.get("name", robot_id),
            robot_type=data.get("robot_type", "drone"),
            status="idle",
            last_seen=time.time(),
        )
        self.robots[robot_id] = robot
        return robot

    def update_position(self, robot_id: str, data: dict[str, Any]) -> RobotState | None:
        robot = self.robots.get(robot_id)
        if robot is None:
            return None
        robot.latitude = data.get("latitude", robot.latitude)
        robot.longitude = data.get("longitude", robot.longitude)
        robot.altitude = data.get("altitude", robot.altitude)
        robot.heading = data.get("heading", robot.heading)
        robot.speed = data.get("speed", robot.speed)
        robot.last_seen = time.time()
        if robot.status == "idle":
            robot.status = "active"
        return robot

    def update_health(self, robot_id: str, data: dict[str, Any]) -> RobotState | None:
        robot = self.robots.get(robot_id)
        if robot is None:
            return None
        robot.battery_percent = data.get("battery_percent", robot.battery_percent)
        robot.signal_strength = data.get("signal_strength", robot.signal_strength)
        robot.last_seen = time.time()
        return robot

    def update_status(self, robot_id: str, data: dict[str, Any]) -> RobotState | None:
        robot = self.robots.get(robot_id)
        if robot is None:
            # Auto-register if we get a status message for unknown robot
            return self.register_robot(robot_id, data)
        robot.status = data.get("status", robot.status)
        robot.last_seen = time.time()
        return robot

    def get_full_state(self) -> dict[str, Any]:
        from app.services.mission_service import mission_service

        return {
            "robots": {rid: r.to_dict() for rid, r in self.robots.items()},
            "missions": {
                mid: m.to_dict() for mid, m in mission_service.missions.items()
            },
        }


state_manager = StateManager()
