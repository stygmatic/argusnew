# Argus Voice-Controlled Fleet Management — Setup Guide

## Architecture

```
Phone Call → Plivo → Vapi Voice Agent (STT + LLM + ElevenLabs TTS)
                        ↓ (tool call)
                   Convex HTTP Action
                        ↓ (HTTP POST)
                   FastAPI REST API (/api/commands/execute)
                        ↓ (MQTT)
                   Simulator / Robots → Frontend UI
```

---

## 1. Backend Configuration

Set the `VOICE_API_KEY` environment variable on your backend. This key protects the `/api/commands/execute` and `/api/commands/fleet-status` endpoints.

```bash
# Generate a secure key
export VOICE_API_KEY=$(openssl rand -hex 32)

# Or for docker-compose, add to your .env:
VOICE_API_KEY=your-secure-key-here
```

The backend reads this from `backend/app/config.py` via the `VOICE_API_KEY` env var.

---

## 2. Convex Setup

### Initialize

```bash
cd voice/
npm install
npx convex dev
```

When prompted, select your Convex project or create a new one.

### Environment Variables

Set these in the Convex dashboard (Settings → Environment Variables) or via CLI:

```bash
npx convex env set ARGUS_BACKEND_URL "https://your-backend-url.example.com"
npx convex env set VOICE_API_KEY "same-key-as-backend"
```

- `ARGUS_BACKEND_URL` — the public URL of your FastAPI backend (must be reachable from Convex cloud)
- `VOICE_API_KEY` — must match the backend's `VOICE_API_KEY`

### Deploy

```bash
npx convex deploy
```

Note the deployment URL — you'll need it for Vapi tool configuration:
`https://<your-deployment>.convex.site`

---

## 3. Vapi Voice Agent Setup

### Create Assistant

1. Go to [Vapi Dashboard](https://dashboard.vapi.ai)
2. Create a new Assistant
3. Configure:

**Model:** GPT-4o (or Claude)

**Voice:** ElevenLabs — select a professional dispatcher voice (e.g., "Adam" or "Antoni")

- ElevenLabs API Key: `REDACTED_ELEVENLABS_KEY`

**System Prompt:**

```
You are Argus Command, a professional fleet dispatcher for the Argus autonomous robot ground station in Fremont, California. You manage a fleet of surveillance drones, ground rovers, and an underwater vehicle.

Available commands:
- dispatchDrones: Send drones to a location. Args: location (address or coords), count (default 2), missionType (surveillance/patrol/recon)
- getFleetStatus: Get current status of all robots
- recallRobots: Recall robots to home base. Args: robotIds (optional, defaults to all)
- stopRobots: Emergency stop. Args: robotIds (optional, defaults to all)
- createSurveillanceMission: Set up a patrol mission at a location. Args: location, radius (meters), duration (minutes)

When receiving commands:
1. Confirm the location and action before executing
2. Use professional, concise radio-style language
3. Report back with unit callsigns (e.g., "Scout Alpha and Scout Bravo dispatched")
4. If the request is unclear, ask for clarification
5. For emergencies, execute immediately and confirm after

You operate in the Fremont, CA area. Convert street addresses to approximate coordinates using your knowledge of the area.
```

### Configure Tools

Add 5 **Custom Tools** with Server URL: `https://<your-convex-deployment>.convex.site/vapi/tool-call`

**Tool 1: dispatchDrones**
```json
{
  "type": "function",
  "function": {
    "name": "dispatchDrones",
    "description": "Dispatch surveillance drones to a specified location",
    "parameters": {
      "type": "object",
      "properties": {
        "location": { "type": "string", "description": "Target location (landmark name or lat,lon)" },
        "count": { "type": "number", "description": "Number of drones to dispatch (default 2)" },
        "missionType": { "type": "string", "description": "Mission type: surveillance, patrol, or recon" }
      },
      "required": ["location"]
    }
  }
}
```

**Tool 2: getFleetStatus**
```json
{
  "type": "function",
  "function": {
    "name": "getFleetStatus",
    "description": "Get the current status of all robots in the fleet",
    "parameters": { "type": "object", "properties": {} }
  }
}
```

**Tool 3: recallRobots**
```json
{
  "type": "function",
  "function": {
    "name": "recallRobots",
    "description": "Recall robots back to home base",
    "parameters": {
      "type": "object",
      "properties": {
        "robotIds": { "type": "array", "items": { "type": "string" }, "description": "Specific robot IDs to recall (omit for all)" }
      }
    }
  }
}
```

**Tool 4: stopRobots**
```json
{
  "type": "function",
  "function": {
    "name": "stopRobots",
    "description": "Emergency stop — halt all or specified robots immediately",
    "parameters": {
      "type": "object",
      "properties": {
        "robotIds": { "type": "array", "items": { "type": "string" }, "description": "Specific robot IDs to stop (omit for all)" }
      }
    }
  }
}
```

**Tool 5: createSurveillanceMission**
```json
{
  "type": "function",
  "function": {
    "name": "createSurveillanceMission",
    "description": "Create a surveillance patrol mission at a location",
    "parameters": {
      "type": "object",
      "properties": {
        "location": { "type": "string", "description": "Target location for surveillance" },
        "radius": { "type": "number", "description": "Patrol radius in meters (default 200)" },
        "duration": { "type": "number", "description": "Mission duration in minutes (default 30)" }
      },
      "required": ["location"]
    }
  }
}
```

### Vapi API Keys

- Private Key: `REDACTED_VAPI_PRIVATE_KEY`
- Public Key: `REDACTED_VAPI_PUBLIC_KEY`

---

## 4. Plivo Phone Number Setup

1. Log in to [Plivo Console](https://console.plivo.com)
   - Auth ID: `MAZDA4NJRLOGQTOGRJZS`
   - Auth Token: `MGI4MWI4OGYtZjMwMS00NDQzLTRjODktZWVjZGMy`

2. Buy or assign a phone number

3. Configure the number:
   - **Answer URL**: Set to Vapi's inbound call webhook URL
   - Go to Vapi Dashboard → Phone Numbers → Import → Plivo
   - Vapi will provide the webhook URL to configure

4. Vapi handles the entire call lifecycle (answer, transcribe, process, respond)

---

## 5. Testing the Flow

### Test Backend Endpoints

```bash
# Test fleet status
curl -H "X-API-Key: $VOICE_API_KEY" http://localhost:8000/api/commands/fleet-status

# Test command execution
curl -X POST http://localhost:8000/api/commands/execute \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $VOICE_API_KEY" \
  -d '{"robot_id":"drone-001","command_type":"goto","parameters":{"latitude":37.55,"longitude":-121.99},"source":"voice"}'

# Test auth rejection
curl http://localhost:8000/api/commands/fleet-status
# Should return 401
```

### Test Convex

```bash
cd voice/
npx convex run actions/fleetCommands:getFleetStatus
```

### Test Full Voice Flow

1. Call the Plivo phone number
2. Say: "What's the fleet status?"
3. Verify Vapi responds with robot statuses
4. Say: "Dispatch drones to Fremont Blvd and Paseo Padre"
5. Verify drones move on the map UI
6. Verify "Voice Active" indicator appears in the header bar

---

## Supported Fremont Landmarks

The system recognizes these locations by name:

| Landmark | Coordinates |
|----------|------------|
| Fremont Blvd and Paseo Padre | 37.5483, -121.9875 |
| Fremont Blvd | 37.5485, -121.9886 |
| Mission San Jose | 37.5305, -121.9183 |
| Lake Elizabeth | 37.5590, -121.9648 |
| Niles Canyon | 37.5765, -121.9584 |
| Fremont BART | 37.5574, -121.9764 |
| Warm Springs BART | 37.5022, -121.9396 |
| Tesla Factory | 37.4932, -121.9445 |
| Auto Mall Parkway | 37.5098, -121.9457 |
| Central Park | 37.5480, -121.9630 |
| Fremont Hub | 37.5485, -121.9880 |

You can also provide raw coordinates: "37.55, -121.99"
