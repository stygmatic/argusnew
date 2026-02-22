from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class RobotConfig:
    id: str
    name: str
    robot_type: str
    start_lat: float
    start_lon: float
    start_alt: float = 0.0
    start_heading: float = 0.0
    patrol_radius: float = 300.0
    max_speed: float = 5.0
    failure_probability: float = 0.001


@dataclass
class SimConfig:
    mqtt_broker: str = os.environ.get("MQTT_BROKER", "localhost")
    mqtt_port: int = int(os.environ.get("MQTT_PORT", "1883"))
    mqtt_user: str = os.environ.get("MQTT_USER", "")
    mqtt_password: str = os.environ.get("MQTT_PASSWORD", "")
    backend_url: str = os.environ.get("BACKEND_URL", "http://localhost:8000")
    publish_interval: float = 0.5
    robots: list[RobotConfig] = field(default_factory=list)

    @classmethod
    def default(cls) -> SimConfig:
        # Fremont, CA area coordinates
        return cls(
            robots=[
                # --- Drones ---
                RobotConfig(
                    id="drone-001",
                    name="Scout Alpha",
                    robot_type="drone",
                    start_lat=37.5485,
                    start_lon=-121.9886,
                    start_alt=50.0,
                    patrol_radius=350,
                    max_speed=8.0,
                ),
                RobotConfig(
                    id="drone-002",
                    name="Scout Bravo",
                    robot_type="drone",
                    start_lat=37.5500,
                    start_lon=-121.9860,
                    start_alt=65.0,
                    patrol_radius=250,
                    max_speed=6.0,
                ),
                # --- Ground robots ---
                RobotConfig(
                    id="rover-001",
                    name="Rover One",
                    robot_type="ground",
                    start_lat=37.5470,
                    start_lon=-121.9910,
                    patrol_radius=200,
                    max_speed=2.0,
                ),
                RobotConfig(
                    id="rover-002",
                    name="Rover Two",
                    robot_type="ground",
                    start_lat=37.5495,
                    start_lon=-121.9920,
                    patrol_radius=150,
                    max_speed=1.5,
                ),
                # --- Underwater ---
                RobotConfig(
                    id="uuv-001",
                    name="Depth Finder",
                    robot_type="underwater",
                    start_lat=37.5430,
                    start_lon=-121.9620,
                    start_alt=-15.0,
                    patrol_radius=120,
                    max_speed=1.2,
                ),
            ]
        )
