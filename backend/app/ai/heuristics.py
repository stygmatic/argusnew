from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from app.services.state_manager import RobotState

logger = logging.getLogger(__name__)


@dataclass
class Alert:
    robot_id: str
    alert_type: str  # battery_critical | battery_warning | signal_low | speed_anomaly | proximity
    severity: str  # info | warning | critical
    title: str
    description: str
    reasoning: str
    requires_ai: bool = False
    proposed_action: dict[str, Any] | None = None


class HeuristicAnalyzer:
    """Rule-based checks on telemetry. Fast, no AI calls."""

    def __init__(self) -> None:
        # Cooldowns: (robot_id, alert_type) -> last_triggered_time
        self._cooldowns: dict[tuple[str, str], float] = {}
        self._cooldown_secs = 300.0  # Don't repeat the same alert within 5 minutes

    def _should_fire(self, robot_id: str, alert_type: str) -> bool:
        key = (robot_id, alert_type)
        last = self._cooldowns.get(key, 0)
        if time.time() - last < self._cooldown_secs:
            return False
        self._cooldowns[key] = time.time()
        return True

    def analyze(self, robot: RobotState) -> list[Alert]:
        alerts: list[Alert] = []

        # Battery critical
        if robot.battery_percent < 15 and self._should_fire(robot.id, "battery_critical"):
            alerts.append(Alert(
                robot_id=robot.id,
                alert_type="battery_critical",
                severity="critical",
                title="Critical Battery Level",
                description=f"{robot.name} battery at {robot.battery_percent:.0f}%. Immediate return recommended.",
                reasoning=f"Battery below 15% threshold ({robot.battery_percent:.0f}%). Risk of power loss.",
                proposed_action={"commandType": "return_home", "robotId": robot.id},
            ))

        # Battery warning
        elif robot.battery_percent < 30 and self._should_fire(robot.id, "battery_warning"):
            alerts.append(Alert(
                robot_id=robot.id,
                alert_type="battery_warning",
                severity="warning",
                title="Low Battery Warning",
                description=f"{robot.name} battery at {robot.battery_percent:.0f}%.",
                reasoning=f"Battery below 30% threshold ({robot.battery_percent:.0f}%). Consider returning.",
                requires_ai=True,
            ))

        # Signal degradation
        if robot.signal_strength < 30 and self._should_fire(robot.id, "signal_low"):
            alerts.append(Alert(
                robot_id=robot.id,
                alert_type="signal_low",
                severity="warning",
                title="Weak Signal",
                description=f"{robot.name} signal strength at {robot.signal_strength:.0f}%.",
                reasoning=f"Signal below 30% ({robot.signal_strength:.0f}%). Communication may be unreliable.",
                requires_ai=True,
            ))

        # Speed anomaly (robot reporting speed but shouldn't be moving or vice versa)
        if robot.speed > 20 and self._should_fire(robot.id, "speed_anomaly"):
            alerts.append(Alert(
                robot_id=robot.id,
                alert_type="speed_anomaly",
                severity="warning",
                title="High Speed Alert",
                description=f"{robot.name} moving at {robot.speed:.1f} m/s.",
                reasoning=f"Speed exceeds 20 m/s threshold. Verify intended behavior.",
                requires_ai=True,
            ))

        return alerts

    def check_proximity(self, robots: dict[str, RobotState], threshold_m: float = 15.0) -> list[Alert]:
        """Check for robots that are dangerously close to each other."""
        import math

        alerts: list[Alert] = []
        ids = list(robots.keys())
        for i, id_a in enumerate(ids):
            for id_b in ids[i + 1:]:
                ra, rb = robots[id_a], robots[id_b]
                if ra.status == "offline" or rb.status == "offline":
                    continue
                # Approximate distance using Haversine
                dlat = math.radians(rb.latitude - ra.latitude)
                dlon = math.radians(rb.longitude - ra.longitude)
                a = math.sin(dlat / 2) ** 2 + \
                    math.cos(math.radians(ra.latitude)) * math.cos(math.radians(rb.latitude)) * \
                    math.sin(dlon / 2) ** 2
                dist = 6_371_000 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

                if dist < threshold_m and self._should_fire(id_a, f"proximity_{id_b}"):
                    alerts.append(Alert(
                        robot_id=id_a,
                        alert_type="proximity",
                        severity="warning",
                        title="Proximity Alert",
                        description=f"{ra.name} and {rb.name} are {dist:.0f}m apart.",
                        reasoning=f"Distance ({dist:.0f}m) below {threshold_m:.0f}m safety threshold.",
                        requires_ai=True,
                    ))

        return alerts


heuristic_analyzer = HeuristicAnalyzer()
