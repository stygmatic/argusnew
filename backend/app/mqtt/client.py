from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable, Coroutine

import aiomqtt

from app.config import settings

logger = logging.getLogger(__name__)

# Type for message handler callbacks
MessageHandler = Callable[[str, dict[str, Any]], Coroutine[Any, Any, None]]


class MQTTClient:
    def __init__(self) -> None:
        self._client: aiomqtt.Client | None = None
        self._handlers: dict[str, MessageHandler] = {}
        self._task: asyncio.Task[None] | None = None

    def on(self, topic_pattern: str, handler: MessageHandler) -> None:
        """Register a handler for a topic pattern."""
        self._handlers[topic_pattern] = handler

    async def start(self) -> None:
        """Connect to MQTT broker and start listening."""
        self._task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        while True:
            try:
                kwargs: dict[str, Any] = {
                    "hostname": settings.mqtt_broker,
                    "port": settings.mqtt_port,
                }
                if settings.mqtt_user:
                    kwargs["username"] = settings.mqtt_user
                    kwargs["password"] = settings.mqtt_password
                async with aiomqtt.Client(**kwargs) as client:
                    self._client = client
                    logger.info(
                        "Connected to MQTT broker at %s:%d",
                        settings.mqtt_broker,
                        settings.mqtt_port,
                    )
                    await client.subscribe("argus/#")
                    async for message in client.messages:
                        topic = str(message.topic)
                        try:
                            payload = json.loads(message.payload)
                        except (json.JSONDecodeError, TypeError):
                            logger.warning("Invalid JSON on topic %s", topic)
                            continue
                        await self._dispatch(topic, payload)
            except aiomqtt.MqttError as e:
                logger.warning("MQTT connection lost: %s. Reconnecting in 3s...", e)
                await asyncio.sleep(3)

    async def _dispatch(self, topic: str, payload: dict[str, Any]) -> None:
        """Route messages to registered handlers based on topic patterns."""
        parts = topic.split("/")
        # argus/{robot_id}/telemetry/position -> category = "telemetry"
        # argus/{robot_id}/command/ack -> category = "command", subcategory = "ack"
        if len(parts) >= 3:
            category = parts[2]
            subcategory = parts[3] if len(parts) >= 4 else ""

            # Skip our own outgoing command/execute messages
            if category == "command" and subcategory == "execute":
                return

            for pattern, handler in self._handlers.items():
                if category == pattern or pattern == "*":
                    try:
                        await handler(topic, payload)
                    except Exception:
                        logger.exception("Error in handler for %s", topic)

    async def publish(self, topic: str, payload: dict[str, Any]) -> None:
        """Publish a message to the MQTT broker."""
        if self._client is not None:
            await self._client.publish(topic, json.dumps(payload).encode())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass


mqtt_client = MQTTClient()
