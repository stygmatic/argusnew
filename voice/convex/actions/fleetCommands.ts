"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";

// ── Backend HTTP helper ─────────────────────────────────────────────────

const TIMEOUT_MS = 8_000;

async function callBackend(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const backendUrl = process.env.ARGUS_BACKEND_URL;
  const apiKey = process.env.VOICE_API_KEY;
  if (!backendUrl || !apiKey) {
    throw new Error("Backend URL or API key not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${backendUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Backend returned ${res.status}: ${text}`);
    }
    return await res.json();
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Backend request timed out after 8 seconds");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Haversine distance (meters) ─────────────────────────────────────────

function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Types ───────────────────────────────────────────────────────────────

interface RobotSummary {
  id: string;
  name: string;
  type: string;
  status: string;
  battery: number;
  position: { latitude: number; longitude: number; altitude: number };
  autonomyTier: string;
}

// ── Fremont, CA landmark coordinates ────────────────────────────────────

const FREMONT_LANDMARKS: Record<string, { lat: number; lon: number }> = {
  "fremont blvd and paseo padre": { lat: 37.5483, lon: -121.9875 },
  "fremont blvd": { lat: 37.5485, lon: -121.9886 },
  "paseo padre": { lat: 37.5480, lon: -121.9870 },
  "mission san jose": { lat: 37.5305, lon: -121.9183 },
  "lake elizabeth": { lat: 37.5590, lon: -121.9648 },
  "niles canyon": { lat: 37.5765, lon: -121.9584 },
  "fremont bart": { lat: 37.5574, lon: -121.9764 },
  "warm springs bart": { lat: 37.5022, lon: -121.9396 },
  "tesla factory": { lat: 37.4932, lon: -121.9445 },
  "auto mall parkway": { lat: 37.5098, lon: -121.9457 },
  "central park": { lat: 37.5480, lon: -121.9630 },
  "fremont hub": { lat: 37.5485, lon: -121.9880 },
};

function resolveLocation(location: string): { lat: number; lon: number } | null {
  const lower = location.toLowerCase().trim();

  // Check exact / partial landmark matches
  for (const [name, coords] of Object.entries(FREMONT_LANDMARKS)) {
    if (lower.includes(name)) return coords;
  }

  // Try to parse "lat,lon" format
  const parts = lower.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { lat: parts[0], lon: parts[1] };
  }

  return null;
}

// ── Actions ─────────────────────────────────────────────────────────────

export const dispatchDrones = action({
  args: {
    location: v.string(),
    count: v.optional(v.number()),
    missionType: v.optional(v.string()),
    callId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    try {
      const coords = resolveLocation(args.location);
      if (!coords) {
        return `Unable to resolve location "${args.location}". Please provide a known Fremont landmark or coordinates.`;
      }

      const data = (await callBackend("GET", "/api/commands/fleet-status")) as {
        robots: RobotSummary[];
      };
      const drones = data.robots.filter(
        (r) => r.type === "drone" && r.status !== "error" && r.status !== "offline",
      );
      if (drones.length === 0) {
        return "No available drones in the fleet. All units are offline or in error state.";
      }

      // Sort by distance and pick closest N
      const count = args.count ?? 2;
      const sorted = drones
        .map((d) => ({
          ...d,
          dist: haversineMeters(d.position.latitude, d.position.longitude, coords.lat, coords.lon),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, count);

      const dispatched: string[] = [];
      for (const drone of sorted) {
        const result = (await callBackend("POST", "/api/commands/execute", {
          robot_id: drone.id,
          command_type: "goto",
          parameters: { latitude: coords.lat, longitude: coords.lon },
          source: "voice",
        })) as { command_id?: string; status?: string; error?: string };

        if (result.command_id) {
          dispatched.push(drone.name);
        }
      }

      if (dispatched.length === 0) {
        return "Failed to dispatch any drones. Command relay error, please repeat.";
      }

      const names = dispatched.join(" and ");
      const mType = args.missionType ?? "surveillance";
      return `Copy. ${names} dispatched to ${args.location} for ${mType}. ${dispatched.length} unit${dispatched.length > 1 ? "s" : ""} en route.`;
    } catch {
      return "Unable to dispatch drones at this time. Command relay error, please repeat.";
    }
  },
});

export const getFleetStatus = action({
  args: { callId: v.optional(v.string()) },
  handler: async (_ctx, _args) => {
    try {
      const data = (await callBackend("GET", "/api/commands/fleet-status")) as {
        robots: RobotSummary[];
      };

      if (data.robots.length === 0) {
        return "No robots currently registered in the fleet.";
      }

      const lines = data.robots.map((r) => {
        const bat = Math.round(r.battery);
        return `${r.name}: ${r.status}, ${bat}% battery, tier ${r.autonomyTier}`;
      });

      return `Fleet status — ${data.robots.length} units online.\n${lines.join(". ")}`;
    } catch {
      return "Unable to retrieve fleet status. Command relay error, please try again.";
    }
  },
});

export const recallRobots = action({
  args: {
    robotIds: v.optional(v.array(v.string())),
    callId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    try {
      const data = (await callBackend("GET", "/api/commands/fleet-status")) as {
        robots: RobotSummary[];
      };

      const targets = args.robotIds
        ? data.robots.filter((r) => args.robotIds!.includes(r.id))
        : data.robots.filter((r) => r.status !== "offline");

      const recalled: string[] = [];
      for (const robot of targets) {
        const result = (await callBackend("POST", "/api/commands/execute", {
          robot_id: robot.id,
          command_type: "return_home",
          parameters: {},
          source: "voice",
        })) as { command_id?: string };

        if (result.command_id) recalled.push(robot.name);
      }

      if (recalled.length === 0) {
        return "No units available to recall.";
      }

      return `Copy. Recall order sent to ${recalled.join(", ")}. ${recalled.length} unit${recalled.length > 1 ? "s" : ""} returning to base.`;
    } catch {
      return "Unable to recall units. Command relay error, please repeat.";
    }
  },
});

export const stopRobots = action({
  args: {
    robotIds: v.optional(v.array(v.string())),
    callId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    try {
      const data = (await callBackend("GET", "/api/commands/fleet-status")) as {
        robots: RobotSummary[];
      };

      const targets = args.robotIds
        ? data.robots.filter((r) => args.robotIds!.includes(r.id))
        : data.robots.filter((r) => r.status !== "offline");

      const stopped: string[] = [];
      for (const robot of targets) {
        const result = (await callBackend("POST", "/api/commands/execute", {
          robot_id: robot.id,
          command_type: "stop",
          parameters: {},
          source: "voice",
        })) as { command_id?: string };

        if (result.command_id) stopped.push(robot.name);
      }

      if (stopped.length === 0) {
        return "No units available to stop.";
      }

      return `Emergency stop confirmed. ${stopped.join(", ")} holding position. ${stopped.length} unit${stopped.length > 1 ? "s" : ""} stopped.`;
    } catch {
      return "Emergency stop could not be confirmed. Command relay error, please repeat immediately.";
    }
  },
});

export const executeAICommand = action({
  args: {
    instruction: v.string(),
    callId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    try {
      const result = (await callBackend("POST", "/api/ai/execute", {
        objective: args.instruction,
        source: "voice",
      })) as { commands?: unknown[]; explanation?: string; error?: string };

      if (result.error) {
        return `AI could not execute that instruction: ${result.error}`;
      }

      const cmdCount = result.commands?.length ?? 0;
      const explanation = result.explanation ?? "Commands dispatched.";
      return `Copy. ${explanation} ${cmdCount} command${cmdCount !== 1 ? "s" : ""} dispatched.`;
    } catch {
      return "Unable to process AI command. Command relay error, please repeat.";
    }
  },
});

export const createSurveillanceMission = action({
  args: {
    location: v.string(),
    radius: v.optional(v.number()),
    duration: v.optional(v.number()),
    callId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    try {
      const coords = resolveLocation(args.location);
      if (!coords) {
        return `Unable to resolve location "${args.location}". Please provide a known Fremont landmark or coordinates.`;
      }

      const data = (await callBackend("GET", "/api/commands/fleet-status")) as {
        robots: RobotSummary[];
      };
      const drones = data.robots.filter(
        (r) => r.type === "drone" && r.status !== "error" && r.status !== "offline",
      );
      if (drones.length === 0) {
        return "No available drones for surveillance mission.";
      }

      // Pick 2 closest drones
      const sorted = drones
        .map((d) => ({
          ...d,
          dist: haversineMeters(d.position.latitude, d.position.longitude, coords.lat, coords.lon),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 2);

      const dispatched: string[] = [];
      for (const drone of sorted) {
        // First send goto to target location
        const gotoResult = (await callBackend("POST", "/api/commands/execute", {
          robot_id: drone.id,
          command_type: "goto",
          parameters: { latitude: coords.lat, longitude: coords.lon },
          source: "voice",
        })) as { command_id?: string };

        if (gotoResult.command_id) dispatched.push(drone.name);
      }

      if (dispatched.length === 0) {
        return "Unable to create surveillance mission. Command relay error, please repeat.";
      }

      const radius = args.radius ?? 200;
      const duration = args.duration ?? 30;
      return `Surveillance mission created. ${dispatched.join(" and ")} dispatched to ${args.location}. Patrol radius ${radius} meters, duration ${duration} minutes.`;
    } catch {
      return "Unable to create surveillance mission. Command relay error, please repeat.";
    }
  },
});
