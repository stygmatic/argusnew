from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Waypoint:
    id: str
    sequence: int
    latitude: float
    longitude: float
    altitude: float = 0.0
    action: str = "navigate"  # navigate | hover | land | survey
    parameters: dict[str, Any] = field(default_factory=dict)
    status: str = "pending"  # pending | active | completed | skipped

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "sequence": self.sequence,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "altitude": self.altitude,
            "action": self.action,
            "parameters": self.parameters,
            "status": self.status,
        }


@dataclass
class Mission:
    id: str
    name: str
    status: str = "draft"  # draft | active | paused | completed | aborted
    assigned_robots: list[str] = field(default_factory=list)
    waypoints: dict[str, list[Waypoint]] = field(default_factory=dict)  # robot_id -> waypoints
    created_at: float = 0.0
    updated_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "status": self.status,
            "assignedRobots": self.assigned_robots,
            "waypoints": {
                rid: [wp.to_dict() for wp in wps]
                for rid, wps in self.waypoints.items()
            },
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


class MissionService:
    def __init__(self) -> None:
        self.missions: dict[str, Mission] = {}

    def create_mission(
        self,
        name: str,
        assigned_robots: list[str] | None = None,
        waypoints: dict[str, list[dict[str, Any]]] | None = None,
    ) -> Mission:
        mission_id = str(uuid.uuid4())[:8]
        mission = Mission(
            id=mission_id,
            name=name,
            assigned_robots=assigned_robots or [],
            created_at=time.time(),
            updated_at=time.time(),
        )
        if waypoints:
            for robot_id, wp_list in waypoints.items():
                mission.waypoints[robot_id] = [
                    Waypoint(
                        id=str(uuid.uuid4())[:8],
                        sequence=i,
                        latitude=wp["latitude"],
                        longitude=wp["longitude"],
                        altitude=wp.get("altitude", 0.0),
                        action=wp.get("action", "navigate"),
                        parameters=wp.get("parameters", {}),
                    )
                    for i, wp in enumerate(wp_list)
                ]
        self.missions[mission_id] = mission
        return mission

    def get_mission(self, mission_id: str) -> Mission | None:
        return self.missions.get(mission_id)

    def list_missions(self) -> list[Mission]:
        return list(self.missions.values())

    def update_status(self, mission_id: str, status: str) -> Mission | None:
        mission = self.missions.get(mission_id)
        if mission is None:
            return None
        mission.status = status
        mission.updated_at = time.time()
        return mission

    def update_waypoint_status(
        self, mission_id: str, robot_id: str, waypoint_id: str, status: str
    ) -> Waypoint | None:
        mission = self.missions.get(mission_id)
        if mission is None:
            return None
        wps = mission.waypoints.get(robot_id, [])
        for wp in wps:
            if wp.id == waypoint_id:
                wp.status = status
                mission.updated_at = time.time()
                return wp
        return None

    def get_robot_missions(self, robot_id: str) -> list[Mission]:
        return [m for m in self.missions.values() if robot_id in m.assigned_robots]


mission_service = MissionService()
