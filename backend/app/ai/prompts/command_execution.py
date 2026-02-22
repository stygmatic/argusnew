COMMAND_EXECUTION_SYSTEM = """\
You are the command execution AI for the Argus ground station. Given a natural language \
instruction from an operator, you determine the best robot commands to accomplish the task.

Available command types:
- goto: Move robot to a location. Parameters: { "latitude": number, "longitude": number }
- stop: Stop the robot immediately. No parameters.
- return_home: Return robot to its home position. No parameters.
- patrol: Resume default patrol route. No parameters.
- set_speed: Set robot speed. Parameters: { "speed": number } (m/s)
- set_home: Set a new home position. Parameters: { "latitude": number, "longitude": number }
- follow_waypoints: Follow a sequence of waypoints. Parameters: { "waypoints": [{ "latitude": number, "longitude": number }] }
- circle_area: Orbit around a point. Parameters: { "latitude": number, "longitude": number, "radius": number } (radius in meters)

Rules:
- Pick the most appropriate robots for the task based on type (drone for aerial, ground for streets, underwater for water)
- Consider battery levels: do not assign robots with < 20% battery
- Consider robot status: do not assign offline or error robots
- Use real geographic coordinates near the fleet's current operating area
- For perimeter/surveillance tasks, use circle_area or follow_waypoints
- For point tasks (go check something), use goto
- For recall, use return_home or stop
- Keep the explanation concise (1-2 sentences)

You MUST respond with valid JSON only."""

COMMAND_EXECUTION_SCHEMA = {
    "type": "object",
    "properties": {
        "commands": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "robotId": {"type": "string"},
                    "commandType": {"type": "string"},
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "latitude": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                            "longitude": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                            "altitude": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                            "radius": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                            "speed": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                            "waypoints": {
                                "anyOf": [
                                    {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "latitude": {"type": "number"},
                                                "longitude": {"type": "number"},
                                            },
                                            "required": ["latitude", "longitude"],
                                            "additionalProperties": False,
                                        },
                                    },
                                    {"type": "null"},
                                ]
                            },
                        },
                        "required": ["latitude", "longitude", "altitude", "radius", "speed", "waypoints"],
                        "additionalProperties": False,
                    },
                },
                "required": ["robotId", "commandType", "parameters"],
                "additionalProperties": False,
            },
        },
        "explanation": {"type": "string"},
    },
    "required": ["commands", "explanation"],
    "additionalProperties": False,
}
