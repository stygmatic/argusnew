from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from app.ai.heuristics import Alert, heuristic_analyzer
from app.ai.suggestions import Suggestion, suggestion_service
from app.config import settings
from app.services.autonomy_service import autonomy_service
from app.services.state_manager import RobotState, state_manager
from app.ws.manager import ws_manager

logger = logging.getLogger(__name__)


class AnalysisService:
    """Orchestrates heuristic checks and AI escalation pipeline."""

    def __init__(self) -> None:
        self._ai_queue: asyncio.Queue[Alert] = asyncio.Queue()
        self._worker_task: asyncio.Task[None] | None = None
        self._proximity_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if settings.ai_enabled:
            self._worker_task = asyncio.create_task(self._ai_worker())
            logger.info("AI analysis worker started")
        self._proximity_task = asyncio.create_task(self._proximity_loop())
        logger.info("Analysis service started (ai_enabled=%s)", settings.ai_enabled)

    async def stop(self) -> None:
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
        if self._proximity_task:
            self._proximity_task.cancel()
            try:
                await self._proximity_task
            except asyncio.CancelledError:
                pass
        logger.info("Analysis service stopped")

    async def on_telemetry(self, robot: RobotState) -> None:
        """Called on each telemetry update. Runs heuristic checks."""
        alerts = heuristic_analyzer.analyze(robot)
        for alert in alerts:
            await self._process_alert(alert)

    async def _process_alert(self, alert: Alert) -> None:
        """Convert an alert into a suggestion, possibly escalating to AI."""
        if alert.requires_ai and settings.ai_enabled:
            # Queue for AI analysis
            await self._ai_queue.put(alert)
        else:
            # Create suggestion directly from heuristic
            suggestion = suggestion_service.create(
                robot_id=alert.robot_id,
                title=alert.title,
                description=alert.description,
                reasoning=alert.reasoning,
                severity=alert.severity,
                proposed_action=alert.proposed_action,
                source="heuristic",
            )
            if suggestion:
                await self._broadcast_suggestion(suggestion)

    async def _proximity_loop(self) -> None:
        """Periodically check proximity between robots."""
        while True:
            await asyncio.sleep(30)
            try:
                alerts = heuristic_analyzer.check_proximity(state_manager.robots)
                for alert in alerts:
                    await self._process_alert(alert)
            except Exception:
                logger.exception("Error in proximity check")

    async def _ai_worker(self) -> None:
        """Background worker that processes AI escalations."""
        from app.ai.providers import get_ai_provider
        from app.ai.providers.base import AIMessage

        provider = get_ai_provider()

        while True:
            alert = await self._ai_queue.get()
            try:
                robot = state_manager.robots.get(alert.robot_id)
                if robot is None:
                    continue

                context = self._build_context(robot, alert)
                messages = [
                    AIMessage(role="system", content=self._system_prompt()),
                    AIMessage(role="user", content=context),
                ]

                response = await provider.complete(messages, temperature=0.2, max_tokens=1024)
                ai_analysis = self._parse_ai_response(response.content, alert, robot)
                if ai_analysis:
                    await self._broadcast_suggestion(ai_analysis)

            except Exception:
                logger.exception("AI analysis failed for alert %s on %s", alert.alert_type, alert.robot_id)
                # Fall back to heuristic suggestion
                suggestion = suggestion_service.create(
                    robot_id=alert.robot_id,
                    title=alert.title,
                    description=alert.description,
                    reasoning=alert.reasoning + " (AI analysis unavailable)",
                    severity=alert.severity,
                    proposed_action=alert.proposed_action,
                    source="heuristic",
                )
                if suggestion:
                    await self._broadcast_suggestion(suggestion)

    def _system_prompt(self) -> str:
        return (
            "You are an AI advisor for the Argus ground station managing autonomous robot swarms. "
            "When presented with an alert about a robot, analyze the situation and provide a "
            "JSON response with these fields:\n"
            '- "title": short summary (max 60 chars)\n'
            '- "description": 1-2 sentence explanation\n'
            '- "reasoning": detailed analysis of why this matters\n'
            '- "severity": "info" | "warning" | "critical"\n'
            '- "confidence": 0.0-1.0\n'
            '- "proposedAction": null or {"commandType": "...", "robotId": "...", "parameters": {...}}\n'
            "\nRespond ONLY with valid JSON."
        )

    def _build_context(self, robot: RobotState, alert: Alert) -> str:
        return (
            f"Alert: {alert.alert_type}\n"
            f"Robot: {robot.name} ({robot.id}), type={robot.robot_type}, status={robot.status}\n"
            f"Position: lat={robot.latitude:.5f}, lon={robot.longitude:.5f}, alt={robot.altitude:.1f}m\n"
            f"Speed: {robot.speed:.1f} m/s, Heading: {robot.heading:.0f}deg\n"
            f"Battery: {robot.battery_percent:.0f}%, Signal: {robot.signal_strength:.0f}%\n"
            f"Alert details: {alert.description}\n"
            f"Heuristic reasoning: {alert.reasoning}\n"
        )

    def _parse_ai_response(self, content: str, alert: Alert, robot: RobotState) -> Suggestion | None:
        try:
            # Strip markdown code fences if present
            text = content.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                if text.endswith("```"):
                    text = text[:-3]
                text = text.strip()

            data = json.loads(text)
            return suggestion_service.create(
                robot_id=alert.robot_id,
                title=data.get("title", alert.title),
                description=data.get("description", alert.description),
                reasoning=data.get("reasoning", alert.reasoning),
                severity=data.get("severity", alert.severity),
                proposed_action=data.get("proposedAction", alert.proposed_action),
                confidence=data.get("confidence", 0.7),
                source="ai",
            )
        except (json.JSONDecodeError, KeyError):
            logger.warning("Failed to parse AI response, falling back to heuristic")
            return suggestion_service.create(
                robot_id=alert.robot_id,
                title=alert.title,
                description=alert.description,
                reasoning=alert.reasoning,
                severity=alert.severity,
                proposed_action=alert.proposed_action,
                source="heuristic",
            )

    async def _broadcast_suggestion(self, suggestion: Suggestion) -> None:
        from datetime import datetime, timezone

        robot = state_manager.robots.get(suggestion.robot_id)
        tier = robot.autonomy_tier if robot else "assisted"

        # Tier-aware behavior
        if tier == "manual" and suggestion.proposed_action:
            # Strip proposed action for manual tier
            suggestion.proposed_action = None

        should_execute, countdown = autonomy_service.should_auto_execute(
            suggestion.robot_id, suggestion.proposed_action
        )

        payload = suggestion.to_dict()

        if should_execute and countdown > 0:
            # Supervised: auto-execute after countdown
            auto_execute_at = time.time() + countdown
            payload["autoExecuteAt"] = auto_execute_at
            await ws_manager.broadcast({
                "type": "ai.suggestion",
                "payload": payload,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            await ws_manager.broadcast({
                "type": "autonomy.countdown",
                "payload": {
                    "suggestionId": suggestion.id,
                    "robotId": suggestion.robot_id,
                    "commandType": suggestion.proposed_action.get("commandType", "") if suggestion.proposed_action else "",
                    "autoExecuteAt": auto_execute_at,
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            asyncio.create_task(self._auto_execute_after_delay(suggestion.id, countdown))
        elif should_execute and countdown == 0:
            # Autonomous: execute immediately
            await self._auto_execute(suggestion)
            payload = suggestion.to_dict()
            await ws_manager.broadcast({
                "type": "ai.suggestion",
                "payload": payload,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        else:
            # Manual/Assisted or supervised high-risk: broadcast as-is
            await ws_manager.broadcast({
                "type": "ai.suggestion",
                "payload": payload,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

        logger.info(
            "Suggestion [%s] %s: %s (robot=%s, tier=%s)",
            suggestion.severity, suggestion.source, suggestion.title, suggestion.robot_id, tier,
        )

    async def _auto_execute_after_delay(self, suggestion_id: str, delay: float) -> None:
        """Wait for countdown, then auto-execute if still pending."""
        await asyncio.sleep(delay)
        suggestion = suggestion_service.suggestions.get(suggestion_id)
        if suggestion and suggestion.status == "pending":
            await self._auto_execute(suggestion)

    async def _auto_execute(self, suggestion: Suggestion) -> None:
        """Execute a suggestion's proposed action as AI command."""
        from app.mqtt.client import mqtt_client
        from app.services.command_service import command_service

        if not suggestion.proposed_action:
            return

        robot_id = suggestion.proposed_action.get("robotId", suggestion.robot_id)
        command_type = suggestion.proposed_action.get("commandType", "")
        parameters = suggestion.proposed_action.get("parameters", {})
        robot = state_manager.robots.get(robot_id)

        if not robot or not command_type:
            return

        suggestion.status = "approved"
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
        logger.info("Auto-executed suggestion %s: %s -> %s", suggestion.id, command_type, robot_id)


analysis_service = AnalysisService()
