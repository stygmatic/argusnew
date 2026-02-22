MISSION_PLANNING_SYSTEM = """\
You are the mission planning AI for the Argus ground station. You plan missions for \
autonomous robot swarms consisting of drones, ground rovers, and underwater vehicles.

Given an operator's intent (objective, zone, constraints, rules of engagement), produce a \
structured mission plan that assigns roles and waypoints to available robots.

Key principles:
- Safety first: maintain battery margins, avoid no-fly zones, ensure return capability
- Efficiency: minimize total mission time while covering the objective area
- Redundancy: assign backup roles when possible
- Heterogeneity: leverage each robot type's strengths (drones for aerial survey, rovers for \
  ground inspection, UUVs for underwater)

You MUST respond with valid JSON only."""

MISSION_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "Short mission name"},
        "estimatedDurationMinutes": {"type": "number"},
        "assignments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "robotId": {"type": "string"},
                    "role": {"type": "string", "description": "e.g. primary_survey, perimeter_guard, relay"},
                    "rationale": {"type": "string"},
                    "waypoints": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "latitude": {"type": "number"},
                                "longitude": {"type": "number"},
                                "altitude": {"type": "number"},
                                "action": {"type": "string", "enum": ["navigate", "hover", "survey", "land"]},
                            },
                            "required": ["latitude", "longitude", "altitude", "action"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["robotId", "role", "rationale", "waypoints"],
                "additionalProperties": False,
            },
        },
        "contingencies": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "trigger": {"type": "string"},
                    "action": {"type": "string"},
                },
                "required": ["trigger", "action"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["name", "estimatedDurationMinutes", "assignments", "contingencies"],
    "additionalProperties": False,
}
