import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Map, {
  NavigationControl,
  Marker,
  Source,
  Layer,
  type MapRef,
  type MapLayerMouseEvent,
  type LayerProps,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  useWebSocket,
  useKeyboardShortcuts,
  useRobotStore,
  useUIStore,
  useConnectionStore,
  useCommandStore,
  useAIStore,
  useAutonomyStore,
} from "./lib";
import type {
  RobotState,
  RobotType,
  AutonomyTier,
  Suggestion,
  MissionIntent,
} from "./lib";

// Shared map handle — MapView populates this so other components can flyTo
const mapCtrl = { flyTo: (_lng: number, _lat: number, _zoom?: number) => {} };

/* ════════════════════════════════════════════════════════════════════
   MAP STYLE
   ════════════════════════════════════════════════════════════════════ */

const DEFAULT_CENTER = { longitude: -121.9886, latitude: 37.5485 };
const DEFAULT_ZOOM   = 15;

const DARK_STYLE = {
  version: 8 as const,
  sources: {
    "carto-dark": {
      type: "raster" as const,
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    },
  },
  layers: [{
    id: "carto-dark-layer",
    type: "raster" as const,
    source: "carto-dark",
    minzoom: 0,
    maxzoom: 20,
  }],
};

/* ════════════════════════════════════════════════════════════════════
   CONSTANTS
   ════════════════════════════════════════════════════════════════════ */

const STATUS_COLOR: Record<string, string> = {
  active:    "#00e5a0",
  idle:      "#38bdf8",
  returning: "#f59e0b",
  error:     "#ef4444",
  offline:   "#4b5563",
};
const AUTONOMY_COLOR: Record<string, string> = {
  autonomous: "#00e5a0",
  supervised: "#f59e0b",
  assisted:   "#38bdf8",
  manual:     "#6b7280",
};
const TYPE_ICON:  Record<string, string> = { drone: "▲", ground: "■", underwater: "◉" };
const TYPE_COLOR: Record<string, string> = { drone: "#00e5a0", ground: "#a78bfa", underwater: "#38bdf8" };
const SEV_COLOR:  Record<string, string> = { critical: "#ef4444", warning: "#f59e0b", info: "#38bdf8" };
const AUTONOMY_TIERS: AutonomyTier[]     = ["manual", "assisted", "supervised", "autonomous"];
const AUTONOMY_ABBR: Record<string, string> = {
  manual:     "MAN",
  assisted:   "AID",
  supervised: "SUP",
  autonomous: "AUT",
};

// Command label → UIStore commandMode / sendCommand type
const DRONE_CMDS      = ["Goto", "Patrol", "Waypoints", "Circle", "Set Home", "Return", "Hold"];
const GROUND_CMDS     = ["Goto", "Patrol", "Waypoints", "Circle", "Set Home", "Return", "Stop"];
const UNDERWATER_CMDS = ["Goto", "Patrol", "Waypoints", "Surface", "Set Home", "Return", "Hold"];

// Commands that trigger map-interaction mode
const MAP_CMD_MODE: Record<string, string> = {
  "Goto":      "goto",
  "Waypoints": "set_waypoints",
  "Circle":    "circle_area",
  "Set Home":  "set_home",
};
// Commands dispatched directly over WebSocket
const DIRECT_CMD: Record<string, string> = {
  "Patrol":  "patrol",
  "Return":  "return_home",
  "Hold":    "stop",
  "Stop":    "stop",
  "Surface": "surface",
};

/* ════════════════════════════════════════════════════════════════════
   MICRO COMPONENTS
   ════════════════════════════════════════════════════════════════════ */

function BatteryBar({ pct }: { pct: number }) {
  const r     = Math.round(pct);
  const color = r > 50 ? "#00e5a0" : r > 20 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ width: "100%", height: 3, background: "#1a2030", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ width: `${r}%`, height: "100%", background: color, transition: "width 0.6s ease" }} />
    </div>
  );
}

function SignalBars({ strength }: { strength: number }) {
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 12 }}>
      {[25, 50, 75, 100].map((t, i) => (
        <div key={i} style={{ width: 3, height: 4 + i * 2.5, background: strength >= t ? "#00e5a0" : "#1e2a3a", borderRadius: 1 }} />
      ))}
    </div>
  );
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 8, fontFamily: "monospace", letterSpacing: 1, padding: "2px 6px", borderRadius: 2, background: `${color}18`, border: `1px solid ${color}40`, color }}>
      {children}
    </span>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 8, color: "#2d4060", fontFamily: "monospace", letterSpacing: 2, marginBottom: 7, textTransform: "uppercase" as const, borderBottom: "1px solid #0d1a28", paddingBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
      <span style={{ fontSize: 9, color: "#2d4060", fontFamily: "monospace" }}>{label}</span>
      <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>{value}</span>
    </div>
  );
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 5, height: 5, borderRadius: "50%", background: active ? "#00e5a0" : "#ef4444", boxShadow: active ? "0 0 5px #00e5a0" : "none" }} />
      <span style={{ fontSize: 9, color: active ? "#2d6050" : "#4b2020", fontFamily: "monospace", letterSpacing: 1 }}>{label}</span>
    </div>
  );
}

const TIMEZONES = [
  { label: "UTC",  tz: "UTC" },
  { label: "PT",   tz: "America/Los_Angeles" },
  { label: "MT",   tz: "America/Denver" },
  { label: "CT",   tz: "America/Chicago" },
  { label: "ET",   tz: "America/New_York" },
  { label: "GMT",  tz: "Europe/London" },
  { label: "CET",  tz: "Europe/Paris" },
  { label: "GST",  tz: "Asia/Dubai" },
  { label: "JST",  tz: "Asia/Tokyo" },
];

function LiveClock() {
  const [time,    setTime]    = useState(new Date());
  const [tzIndex, setTzIndex] = useState(0);
  const [open,    setOpen]    = useState(false);

  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);

  const { label, tz } = TIMEZONES[tzIndex]!;
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(time);

  return (
    <div style={{ position: "relative" as const }}>
      <span
        onClick={() => setOpen(x => !x)}
        style={{ fontFamily: "monospace", fontSize: 12, color: "#00e5a0", letterSpacing: 2, cursor: "pointer", userSelect: "none" as const }}
        title="Click to change timezone"
      >
        {formatted} <span style={{ fontSize: 9, color: "#2d6050" }}>{label}</span>
      </span>
      {open && (
        <div style={{ position: "absolute" as const, top: "calc(100% + 8px)", right: 0, background: "#060b13", border: "1px solid #0d1a28", borderRadius: 4, zIndex: 200, minWidth: 120, overflow: "hidden" }}>
          {TIMEZONES.map((zone, i) => (
            <div key={zone.tz} onClick={() => { setTzIndex(i); setOpen(false); }}
              style={{ padding: "7px 14px", cursor: "pointer", fontFamily: "monospace", fontSize: 10, letterSpacing: 1,
                color: i === tzIndex ? "#00e5a0" : "#4b6080",
                background: i === tzIndex ? "rgba(0,229,160,0.06)" : "transparent",
                borderBottom: i < TIMEZONES.length - 1 ? "1px solid #0d1520" : "none",
              }}
              onMouseEnter={e => { if (i !== tzIndex) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)"; }}
              onMouseLeave={e => { if (i !== tzIndex) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              <span style={{ color: i === tzIndex ? "#00e5a0" : "#2d4060", marginRight: 8 }}>{zone.label}</span>
              {new Intl.DateTimeFormat("en-GB", { timeZone: zone.tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(time)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   FLEET STATS
   ════════════════════════════════════════════════════════════════════ */

function FleetStats({ robots }: { robots: RobotState[] }) {
  const active  = robots.filter(r => r.status === "active").length;
  const online  = robots.filter(r => r.status !== "offline").length;
  const avgBatt = robots.length
    ? Math.round(robots.reduce((s, r) => s + (r.health?.batteryPercent ?? 0), 0) / robots.length)
    : 0;
  return (
    <div style={{ display: "flex", borderBottom: "1px solid #0d1a28", flexShrink: 0 }}>
      {[
        { label: "ACTIVE",  value: `${active}/${robots.length}`, color: "#00e5a0" },
        { label: "ONLINE",  value: `${online}/${robots.length}`, color: "#38bdf8" },
        { label: "AVG PWR", value: `${avgBatt}%`, color: avgBatt > 50 ? "#00e5a0" : avgBatt > 20 ? "#f59e0b" : "#ef4444" },
      ].map(s => (
        <div key={s.label} style={{ flex: 1, padding: "8px 6px", textAlign: "center" as const, borderRight: "1px solid #0d1a28" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
          <div style={{ fontSize: 8, color: "#2d4060", fontFamily: "monospace", marginTop: 2, letterSpacing: 1 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   ROBOT LIST ROW
   ════════════════════════════════════════════════════════════════════ */

function RobotRow({ robot, selected, onClick }: { robot: RobotState; selected: boolean; onClick: () => void }) {
  const batt   = robot.health?.batteryPercent ?? 0;
  const signal = robot.health?.signalStrength  ?? 0;
  const nickname = useUIStore(s => s.robotNicknames[robot.id]);
  const displayName = nickname || robot.name;
  return (
    <div onClick={onClick}
      style={{ padding: "10px 14px", background: selected ? "rgba(0,229,160,0.05)" : "transparent", borderLeft: selected ? "2px solid #00e5a0" : "2px solid transparent", cursor: "pointer", borderBottom: "1px solid #0d1520", transition: "background 0.12s" }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"; }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ color: TYPE_COLOR[robot.robotType], fontSize: 10, fontFamily: "monospace" }}>{TYPE_ICON[robot.robotType]}</span>
        <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, fontFamily: "monospace", flex: 1 }}>{displayName}</span>
        <span style={{ fontSize: 9, color: AUTONOMY_COLOR[robot.autonomyTier], fontFamily: "monospace", letterSpacing: 1 }}>{AUTONOMY_ABBR[robot.autonomyTier] ?? robot.autonomyTier.slice(0,3).toUpperCase()}</span>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLOR[robot.status], boxShadow: robot.status === "active" ? `0 0 6px ${STATUS_COLOR[robot.status]}` : "none" }} />
      </div>
      <BatteryBar pct={batt} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
        <span style={{ fontSize: 9, color: "#2d4060", fontFamily: "monospace" }}>{robot.id}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <SignalBars strength={signal} />
          <span style={{ fontSize: 9, color: "#4b6080", fontFamily: "monospace" }}>{Math.round(batt)}%</span>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   WAYPOINT EDITOR (floating panel inside detail panel)
   ════════════════════════════════════════════════════════════════════ */

const iconBtn: React.CSSProperties = {
  background: "none", border: "none", color: "#2d4060",
  cursor: "pointer", fontFamily: "monospace", fontSize: 11, padding: "1px 4px",
};

function WaypointEditor({ onClose }: { onClose: () => void }) {
  const waypoints    = useUIStore(s => s.pendingWaypoints);
  const undoWaypoint = useUIStore(s => s.undoWaypoint);
  const clearWaypoints = useUIStore(s => s.clearWaypoints);
  const addWaypoint  = useUIStore(s => s.addWaypoint);
  const sendCommand  = useCommandStore(s => s.sendCommand);
  const selectedId   = useUIStore(s => s.selectedRobotId);
  const setMode      = useUIStore(s => s.setCommandMode);

  const move = (from: number, to: number) => {
    const reordered = [...waypoints];
    const item = reordered.splice(from, 1)[0];
    if (!item) return;
    reordered.splice(to, 0, item);
    clearWaypoints();
    reordered.forEach(wp => addWaypoint(wp.lat, wp.lng));
  };

  const removeAt = (idx: number) => {
    const next = waypoints.filter((_, i) => i !== idx);
    clearWaypoints();
    next.forEach(wp => addWaypoint(wp.lat, wp.lng));
  };

  const sendWaypoints = () => {
    if (!selectedId || waypoints.length === 0) return;
    sendCommand(selectedId, "set_waypoints", {
      waypoints: waypoints.map((wp, i) => ({ latitude: wp.lat, longitude: wp.lng, altitude: 0, sequence: i, action: "waypoint", parameters: {}, status: "pending", id: `wp-${i}` })),
    });
    clearWaypoints();
    setMode("none");
    onClose();
  };

  return (
    <div style={{ position: "absolute", bottom: 52, left: 8, width: 270, background: "#060b13", border: "1px solid #0d1a28", borderRadius: 4, zIndex: 50, display: "flex", flexDirection: "column", maxHeight: 240 }}>
      <div style={{ padding: "7px 12px", borderBottom: "1px solid #0d1a28", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: "#2d4060", fontFamily: "monospace", letterSpacing: 2 }}>WAYPOINTS ({waypoints.length})</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#2d4060", cursor: "pointer", fontSize: 14 }}>×</button>
      </div>
      {waypoints.length === 0 && (
        <div style={{ padding: "12px", fontSize: 9, color: "#2d4060", fontFamily: "monospace", textAlign: "center" as const }}>
          NO WAYPOINTS — CLICK MAP TO ADD
        </div>
      )}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {waypoints.map((wp, i) => (
          <div key={i} style={{ padding: "5px 12px", borderBottom: "1px solid #0a1520", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, color: "#00e5a0", fontFamily: "monospace", width: 22, flexShrink: 0 }}>WP{i + 1}</span>
            <span style={{ fontSize: 9, color: "#4b6080", fontFamily: "monospace", flex: 1 }}>{wp.lat.toFixed(4)}, {wp.lng.toFixed(4)}</span>
            <button onClick={() => move(i, i - 1)} style={iconBtn} disabled={i === 0}>↑</button>
            <button onClick={() => move(i, i + 1)} style={iconBtn} disabled={i === waypoints.length - 1}>↓</button>
            <button onClick={() => removeAt(i)} style={{ ...iconBtn, color: "#ef444480" }}>✕</button>
          </div>
        ))}
      </div>
      {waypoints.length > 0 && (
        <div style={{ padding: "6px 12px", borderTop: "1px solid #0d1a28", flexShrink: 0, display: "flex", gap: 5 }}>
          <button onClick={clearWaypoints} style={{ flex: 1, padding: "4px", fontSize: 8, fontFamily: "monospace", letterSpacing: 1, background: "transparent", border: "1px solid #1e2a3a", color: "#4b6080", borderRadius: 2, cursor: "pointer" }}>
            CLEAR
          </button>
          <button onClick={undoWaypoint} style={{ flex: 1, padding: "4px", fontSize: 8, fontFamily: "monospace", letterSpacing: 1, background: "transparent", border: "1px solid #1e2a3a", color: "#4b6080", borderRadius: 2, cursor: "pointer" }}>
            UNDO
          </button>
          <button onClick={sendWaypoints} style={{ flex: 2, padding: "4px", fontSize: 8, fontFamily: "monospace", letterSpacing: 1, background: "rgba(0,229,160,0.08)", border: "1px solid rgba(0,229,160,0.3)", color: "#00e5a0", borderRadius: 2, cursor: "pointer" }}>
            SEND
          </button>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   DETAIL PANEL
   ════════════════════════════════════════════════════════════════════ */

function DetailPanel({ robot, followedId, onFollowToggle }: { robot: RobotState; followedId: string | null; onFollowToggle: (id: string | null) => void }) {
  const [showWpEditor, setShowWpEditor] = useState(false);
  const [editingName, setEditingName]   = useState(false);
  const [nameInput, setNameInput]       = useState("");
  const [isRecording, setIsRecording]   = useState(false);

  const selectRobot      = useUIStore(s => s.selectRobot);
  const commandMode      = useUIStore(s => s.commandMode);
  const setCommandMode   = useUIStore(s => s.setCommandMode);
  const pendingWps       = useUIStore(s => s.pendingWaypoints);
  const setRobotTier     = useAutonomyStore(s => s.setRobotTier);
  const sendCommand      = useCommandStore(s => s.sendCommand);
  const nickname         = useUIStore(s => s.robotNicknames[robot.id]);
  const setRobotNickname = useUIStore(s => s.setRobotNickname);

  const displayName = nickname || robot.name;
  const batt       = robot.health?.batteryPercent ?? 0;
  const signal     = robot.health?.signalStrength ?? 0;
  const cmds       = robot.robotType === "underwater" ? UNDERWATER_CMDS : robot.robotType === "ground" ? GROUND_CMDS : DRONE_CMDS;
  const isFollowing = followedId === robot.id;
  const [showSensors, setShowSensors] = useState(false);

  const startRename = () => { setNameInput(displayName); setEditingName(true); };
  const confirmRename = () => {
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== robot.name) setRobotNickname(robot.id, trimmed);
    else if (trimmed === robot.name) setRobotNickname(robot.id, "");
    setEditingName(false);
  };

  const handleCmd = (label: string) => {
    const mapMode = MAP_CMD_MODE[label];
    const directCmd = DIRECT_CMD[label];

    if (mapMode) {
      const current = useUIStore.getState().commandMode;
      const newMode = current === mapMode ? "none" : mapMode as any;
      setCommandMode(newMode);
      if (label === "Waypoints" && newMode !== "none") setShowWpEditor(true);
      if (newMode === "none") setShowWpEditor(false);
    } else if (directCmd) {
      sendCommand(robot.id, directCmd);
    }
  };

  const isActiveMode = (label: string) =>
    MAP_CMD_MODE[label] !== undefined && commandMode === MAP_CMD_MODE[label];

  return (
    <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 294, background: "#060b13", borderRight: "1px solid #0d1a28", display: "flex", flexDirection: "column", zIndex: 40 }}>
      {/* Header */}
      <div style={{ padding: "13px 16px", borderBottom: "1px solid #0d1a28", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: TYPE_COLOR[robot.robotType], fontSize: 14 }}>{TYPE_ICON[robot.robotType]}</span>
            {editingName ? (
              <input value={nameInput} onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setEditingName(false); }}
                onBlur={confirmRename}
                autoFocus
                style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700, fontFamily: "monospace", background: "#0a1520", border: "1px solid #00e5a0", borderRadius: 2, padding: "1px 6px", outline: "none", width: 140 }}
              />
            ) : (
              <span onClick={startRename} style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700, fontFamily: "monospace", cursor: "pointer" }} title="Click to rename">
                {displayName}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
            <Tag color={STATUS_COLOR[robot.status] ?? "#6b7280"}>{robot.status.toUpperCase()}</Tag>
            <Tag color={AUTONOMY_COLOR[robot.autonomyTier] ?? "#6b7280"}>{AUTONOMY_ABBR[robot.autonomyTier] ?? robot.autonomyTier.slice(0,3).toUpperCase()}</Tag>
            <span style={{ fontSize: 9, color: "#2d4060", fontFamily: "monospace", alignSelf: "center" }}>{robot.id}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 4, alignItems: "flex-end" }}>
          <button onClick={() => selectRobot(null)} style={{ background: "none", border: "none", color: "#4b6080", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => mapCtrl.flyTo(robot.position.longitude, robot.position.latitude, 17)}
              style={{ fontSize: 7, fontFamily: "monospace", padding: "2px 6px", background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)", color: "#38bdf8", borderRadius: 2, cursor: "pointer", letterSpacing: 1 }}
              title="Center map on this unit"
            >CENTER</button>
            <button
              onClick={() => onFollowToggle(isFollowing ? null : robot.id)}
              style={{ fontSize: 7, fontFamily: "monospace", padding: "2px 6px",
                background: isFollowing ? "rgba(0,229,160,0.12)" : "rgba(0,229,160,0.04)",
                border: `1px solid ${isFollowing ? "rgba(0,229,160,0.4)" : "rgba(0,229,160,0.15)"}`,
                color: isFollowing ? "#00e5a0" : "#2d6050",
                borderRadius: 2, cursor: "pointer", letterSpacing: 1 }}
              title={isFollowing ? "Stop following" : "Follow this unit"}
            >{isFollowing ? "◉ FOLLOWING" : "FOLLOW"}</button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>

        {/* Power */}
        <Section label="POWER">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontSize: 9, color: "#2d4060", fontFamily: "monospace" }}>BATTERY</span>
            <span style={{ fontSize: 10, color: batt > 50 ? "#00e5a0" : batt > 20 ? "#f59e0b" : "#ef4444", fontFamily: "monospace" }}>{Math.round(batt)}%</span>
          </div>
          <BatteryBar pct={batt} />
        </Section>

        {/* Telemetry */}
        <Section label="TELEMETRY">
          <DataRow label="LAT"   value={robot.position.latitude.toFixed(5)} />
          <DataRow label="LON"   value={robot.position.longitude.toFixed(5)} />
          <DataRow label="HDG"   value={`${Math.round(robot.position.heading)}°`} />
          <DataRow label="SPD"   value={`${robot.speed.toFixed(1)} m/s`} />
          {robot.robotType === "drone"      && <DataRow label="ALT"   value={`${robot.position.altitude.toFixed(1)} m`} />}
          {robot.robotType === "underwater" && <DataRow label="DEPTH" value={`${Math.abs(robot.position.altitude).toFixed(1)} m`} />}
          <DataRow label="SIG"   value={`${Math.round(signal)}%`} />
        </Section>

        {/* Autonomy tier */}
        <Section label="AUTONOMY TIER">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
            {AUTONOMY_TIERS.map(t => {
              const active = robot.autonomyTier === t;
              return (
                <button key={t} onClick={() => setRobotTier(robot.id, t)} style={{
                  padding: "6px 0", fontSize: 8, fontFamily: "monospace", letterSpacing: 0.5,
                  background: active ? `${AUTONOMY_COLOR[t]}18` : "#0a1520",
                  border: `1px solid ${active ? AUTONOMY_COLOR[t] : "#0d1a28"}`,
                  color: active ? AUTONOMY_COLOR[t] : "#3a5070",
                  borderRadius: 3, cursor: "pointer", textTransform: "uppercase" as const, transition: "all 0.15s",
                }}>{AUTONOMY_ABBR[t] ?? t.slice(0,3)}</button>
              );
            })}
          </div>
        </Section>

        {/* Commands */}
        <Section label="COMMANDS">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {cmds.map(cmd => {
              const active = isActiveMode(cmd);
              return (
                <button key={cmd} onClick={() => handleCmd(cmd)} style={{
                  padding: "7px 4px", fontSize: 10, fontFamily: "monospace", letterSpacing: 0.5,
                  background: active ? "rgba(0,229,160,0.08)" : "#0a1520",
                  border: `1px solid ${active ? "#00e5a0" : "#0d1a28"}`,
                  color: active ? "#00e5a0" : "#4b6080",
                  borderRadius: 3, cursor: "pointer", transition: "all 0.15s",
                }}>{cmd}</button>
              );
            })}
          </div>

          {commandMode !== "none" && (
            <div style={{ marginTop: 7, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", background: "rgba(0,229,160,0.04)", border: "1px solid rgba(0,229,160,0.15)", borderRadius: 3 }}>
              <span style={{ fontSize: 9, color: "#00e5a0", fontFamily: "monospace" }}>
                ▸ {commandMode === "set_waypoints" ? "Click map to place waypoints" : `Click map to set ${commandMode.replace("_", " ")}`}
              </span>
              <button onClick={() => { setCommandMode("none"); setShowWpEditor(false); }} style={{ fontSize: 8, fontFamily: "monospace", padding: "2px 7px", background: "transparent", border: "1px solid #1e2a3a", color: "#4b6080", borderRadius: 2, cursor: "pointer" }}>
                ESC
              </button>
            </div>
          )}

          {commandMode === "set_waypoints" && !showWpEditor && (
            <button onClick={() => setShowWpEditor(true)} style={{ marginTop: 5, width: "100%", padding: "5px", fontSize: 8, fontFamily: "monospace", letterSpacing: 1, background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.2)", color: "#38bdf8", borderRadius: 2, cursor: "pointer" }}>
              EDIT WAYPOINTS ({pendingWps.length})
            </button>
          )}
        </Section>

        {/* Pending waypoints summary */}
        {pendingWps.length > 0 && (
          <Section label={`PENDING ROUTE (${pendingWps.length} WP)`}>
            {pendingWps.map((wp, i) => (
              <DataRow key={i} label={`WP${i + 1}`} value={`${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}`} />
            ))}
          </Section>
        )}

        {/* Sensor data */}
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => setShowSensors(x => !x)}
            style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: showSensors ? 7 : 0 }}
          >
            <span style={{ fontSize: 8, color: "#2d4060", fontFamily: "monospace", letterSpacing: 2, textTransform: "uppercase" as const, borderBottom: showSensors ? "1px solid #0d1a28" : "none", paddingBottom: showSensors ? 4 : 0, width: "100%", textAlign: "left" as const }}>
              SENSORS {showSensors ? "▾" : "▸"}
            </span>
          </button>
          {showSensors && (() => {
            const meta = robot.metadata ?? {};
            const sensorKeys = Object.keys(meta);
            if (sensorKeys.length === 0) {
              return (
                <div style={{ fontSize: 9, color: "#2d4060", fontFamily: "monospace", padding: "8px 0", textAlign: "center" as const }}>
                  NO SENSOR DATA
                </div>
              );
            }
            return (
              <div>
                {sensorKeys.map(key => {
                  const val = meta[key];
                  let display: string;
                  if (val === null || val === undefined) display = "N/A";
                  else if (typeof val === "number")  display = Number.isInteger(val) ? String(val) : (val as number).toFixed(3);
                  else if (typeof val === "boolean") display = val ? "TRUE" : "FALSE";
                  else if (typeof val === "object")  display = JSON.stringify(val).slice(0, 32);
                  else display = String(val).slice(0, 32);
                  return <DataRow key={key} label={key.toUpperCase().replace(/_/g, " ")} value={display} />;
                })}
              </div>
            );
          })()}
        </div>

        {/* Camera Feed */}
        {robot.robotType === "drone" && (
          <Section label="CAMERA FEED">
            <div style={{ width: "100%", height: 120, background: "#0a1520", border: "1px solid #0d1a28", borderRadius: 3, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 18, color: "#1e2a3a" }}>◎</span>
              <span style={{ fontSize: 8, color: "#2d4060", fontFamily: "monospace", letterSpacing: 1 }}>NO VIDEO SIGNAL</span>
              <span style={{ fontSize: 7, color: "#1e2a3a", fontFamily: "monospace" }}>AWAITING HARDWARE LINK</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => setIsRecording(r => !r)}
                style={{ flex: 1, padding: "5px 0", fontSize: 8, fontFamily: "monospace", letterSpacing: 1,
                  background: isRecording ? "rgba(239,68,68,0.12)" : "#0a1520",
                  border: `1px solid ${isRecording ? "rgba(239,68,68,0.4)" : "#0d1a28"}`,
                  color: isRecording ? "#ef4444" : "#4b6080",
                  borderRadius: 2, cursor: "pointer" }}
              >{isRecording ? "◉ REC" : "RECORD"}</button>
              <button style={{ flex: 1, padding: "5px 0", fontSize: 8, fontFamily: "monospace", letterSpacing: 1, background: "#0a1520", border: "1px solid #0d1a28", color: "#4b6080", borderRadius: 2, cursor: "not-allowed", opacity: 0.5 }}>
                SNAPSHOT
              </button>
            </div>
          </Section>
        )}

        {/* Quick Actions */}
        <Section label="QUICK ACTIONS">
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => sendCommand(robot.id, "return_home")}
              style={{ flex: 1, padding: "7px 4px", fontSize: 9, fontFamily: "monospace", letterSpacing: 0.5, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", color: "#f59e0b", borderRadius: 3, cursor: "pointer" }}>
              GO HOME
            </button>
            <button onClick={() => sendCommand(robot.id, "stop")}
              style={{ flex: 1, padding: "7px 4px", fontSize: 9, fontFamily: "monospace", letterSpacing: 0.5, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444", borderRadius: 3, cursor: "pointer" }}>
              STOP
            </button>
          </div>
        </Section>
      </div>

      {showWpEditor && <WaypointEditor onClose={() => setShowWpEditor(false)} />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   MAP — ROBOT MARKERS
   ════════════════════════════════════════════════════════════════════ */

function robotSvgHtml(type: RobotType, color: string, selected: boolean): string {
  const ring = selected ? `<circle cx="14" cy="14" r="13" fill="none" stroke="#00e5a0" stroke-width="1.5" opacity="0.8"/>` : "";
  const glow = selected ? `<circle cx="14" cy="14" r="10" fill="#00e5a0" opacity="0.1"/>` : "";
  switch (type) {
    case "drone":
      return `<svg width="28" height="28" viewBox="0 0 28 28" fill="none">${ring}${glow}<polygon points="14,3 22,23 14,19 6,23" fill="${color}" opacity="0.92"/></svg>`;
    case "ground":
      return `<svg width="28" height="28" viewBox="0 0 28 28" fill="none">${ring}${glow}<rect x="7" y="9" width="14" height="10" rx="2" fill="${color}" opacity="0.92"/><circle cx="10" cy="21" r="2" fill="${color}" opacity="0.7"/><circle cx="18" cy="21" r="2" fill="${color}" opacity="0.7"/></svg>`;
    case "underwater":
      return `<svg width="28" height="28" viewBox="0 0 28 28" fill="none">${ring}${glow}<ellipse cx="14" cy="14" rx="10" ry="5.5" fill="${color}" opacity="0.92"/><polygon points="24,14 27,11 27,17" fill="${color}" opacity="0.7"/></svg>`;
  }
}

function RobotMarker({ robot }: { robot: RobotState }) {
  const selectedId = useUIStore(s => s.selectedRobotId);
  const selectRobot = useUIStore(s => s.selectRobot);
  const isSelected = selectedId === robot.id;
  const color = STATUS_COLOR[robot.status] ?? "#6b7280";

  const cumulativeRotation = useRef(robot.position.heading);
  const prevHeading        = useRef(robot.position.heading);

  useMemo(() => {
    let delta = robot.position.heading - ((prevHeading.current % 360) + 360) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    cumulativeRotation.current += delta;
    prevHeading.current = robot.position.heading;
  }, [robot.position.heading]);

  const svgHtml = useMemo(() => robotSvgHtml(robot.robotType, color, isSelected), [robot.robotType, color, isSelected]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    selectRobot(useUIStore.getState().selectedRobotId === robot.id ? null : robot.id);
  }, [robot.id, selectRobot]);

  return (
    <Marker longitude={robot.position.longitude} latitude={robot.position.latitude} anchor="center">
      <div onClick={handleClick} style={{ cursor: "pointer" }}>
        <div style={{ transform: `rotate(${cumulativeRotation.current}deg)` }} dangerouslySetInnerHTML={{ __html: svgHtml }} />
        <div style={{ fontSize: 7, fontFamily: "monospace", textAlign: "center" as const, marginTop: 1, color: AUTONOMY_COLOR[robot.autonomyTier], textShadow: "0 1px 3px rgba(0,0,0,0.9)", letterSpacing: 1 }}>
          {AUTONOMY_ABBR[robot.autonomyTier] ?? robot.autonomyTier.slice(0,3).toUpperCase()}
        </div>
      </div>
    </Marker>
  );
}

/* ════════════════════════════════════════════════════════════════════
   MAP — WAYPOINT OVERLAY
   ════════════════════════════════════════════════════════════════════ */

function PendingWaypointLayer() {
  const waypoints  = useUIStore(s => s.pendingWaypoints);
  const selectedId = useUIStore(s => s.selectedRobotId);
  const robots     = useRobotStore(s => s.robots);

  const robot = selectedId ? robots[selectedId] : null;
  const color = robot ? TYPE_COLOR[robot.robotType] : "#00e5a0";

  const lineData = useMemo(() => ({
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: waypoints.map(wp => [wp.lng, wp.lat]),
    },
  }), [waypoints]);

  const lineLayer: LayerProps = useMemo(() => ({
    id: "pending-wp-line",
    type: "line",
    paint: { "line-color": color, "line-width": 1.5, "line-opacity": 0.6, "line-dasharray": [4, 4] },
  }), [color]);

  if (waypoints.length === 0) return null;

  return (
    <>
      {waypoints.length >= 2 && (
        <Source id="pending-wp-src" type="geojson" data={lineData}>
          <Layer {...lineLayer} />
        </Source>
      )}
      {waypoints.map((wp, i) => (
        <Marker key={i} longitude={wp.lng} latitude={wp.lat} anchor="center">
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: color + "40", border: `1px solid ${color}90`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 6, color, fontFamily: "monospace" }}>{i + 1}</div>
          </div>
        </Marker>
      ))}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════
   MAP VIEW
   ════════════════════════════════════════════════════════════════════ */

function MapView({ followedId }: { followedId: string | null }) {
  const mapRef     = useRef<MapRef>(null);
  const robots     = useRobotStore(s => s.robots);
  const robotList  = Object.values(robots);
  const commandMode = useUIStore(s => s.commandMode);
  const setCommandMode = useUIStore(s => s.setCommandMode);
  const addWaypoint = useUIStore(s => s.addWaypoint);
  const setCircleCenter = useUIStore(s => s.setCircleCenter);
  const selectedId = useUIStore(s => s.selectedRobotId);
  const sendCommand = useCommandStore(s => s.sendCommand);

  // Populate shared mapCtrl handle once map loads
  const handleMapLoad = useCallback(() => {
    mapCtrl.flyTo = (lng, lat, zoom = 17) => {
      mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 800, essential: true });
    };
  }, []);

  // Fly to robot when selected
  useEffect(() => {
    if (!selectedId) return;
    const robot = useRobotStore.getState().robots[selectedId];
    if (robot) mapCtrl.flyTo(robot.position.longitude, robot.position.latitude, 17);
  }, [selectedId]);

  // Follow mode — re-center every second while following
  useEffect(() => {
    if (!followedId) return;
    const t = setInterval(() => {
      const robot = useRobotStore.getState().robots[followedId];
      if (robot) {
        mapRef.current?.easeTo({
          center: [robot.position.longitude, robot.position.latitude],
          duration: 800, essential: true,
        });
      }
    }, 1000);
    return () => clearInterval(t);
  }, [followedId]);

  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    if (commandMode === "none") return;
    const { lng, lat } = e.lngLat;

    switch (commandMode) {
      case "goto":
        if (selectedId) sendCommand(selectedId, "goto", { latitude: lat, longitude: lng });
        setCommandMode("none");
        break;
      case "set_home":
        if (selectedId) sendCommand(selectedId, "set_home", { latitude: lat, longitude: lng });
        setCommandMode("none");
        break;
      case "set_waypoints":
        addWaypoint(lat, lng);
        break;
      case "circle_area":
        setCircleCenter({ lat, lng });
        if (selectedId) sendCommand(selectedId, "circle_area", { latitude: lat, longitude: lng, radius: 150 });
        setCommandMode("none");
        break;
    }
  }, [commandMode, selectedId, sendCommand, setCommandMode, addWaypoint, setCircleCenter]);

  const cursor = commandMode !== "none" ? "crosshair" : "grab";

  return (
    <Map
      ref={mapRef}
      initialViewState={{ ...DEFAULT_CENTER, zoom: DEFAULT_ZOOM }}
      style={{ width: "100%", height: "100%" }}
      mapStyle={DARK_STYLE as any}
      cursor={cursor}
      onClick={handleMapClick}
      onLoad={handleMapLoad}
    >
      <NavigationControl position="bottom-right" />
      <PendingWaypointLayer />
      {robotList.map(r => <RobotMarker key={r.id} robot={r} />)}
    </Map>
  );
}

/* ════════════════════════════════════════════════════════════════════
   ALERT CARD
   ════════════════════════════════════════════════════════════════════ */

function AlertCard({ suggestion }: { suggestion: Suggestion }) {
  const [expanded, setExpanded]   = useState(false);
  const rejectSuggestion          = useAIStore(s => s.rejectSuggestion);

  const sc   = SEV_COLOR[suggestion.severity] ?? "#38bdf8";
  const done = suggestion.status !== "pending";

  const elapsed   = Math.round(Date.now() / 1000 - suggestion.createdAt);
  const timeAgo   = elapsed < 60 ? `${elapsed}s ago` : elapsed < 3600 ? `${Math.floor(elapsed / 60)}m ago` : `${Math.floor(elapsed / 3600)}h ago`;

  return (
    <div style={{ borderLeft: `2px solid ${done ? "#1e2a3a" : sc}`, background: done ? "transparent" : `${sc}08`, padding: "10px 12px", marginBottom: 1, opacity: done ? 0.4 : 1, transition: "opacity 0.2s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: "#c8d6e5", fontWeight: 600, flex: 1 }}>{suggestion.title}</span>
        <span style={{ fontSize: 8, color: "#2d4060", fontFamily: "monospace", whiteSpace: "nowrap" as const, marginLeft: 8 }}>{timeAgo}</span>
      </div>
      {expanded && (
        <>
          <p style={{ fontSize: 10, color: "#4b6080", lineHeight: 1.6, marginBottom: 4, fontFamily: "monospace" }}>{suggestion.description}</p>
          {suggestion.reasoning && (
            <p style={{ fontSize: 9, color: "#2d4060", lineHeight: 1.5, marginBottom: 4, fontFamily: "monospace", fontStyle: "italic" }}>{suggestion.reasoning}</p>
          )}
        </>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 8, color: sc, fontFamily: "monospace", letterSpacing: 1 }}>{suggestion.severity.toUpperCase()}</span>
        <span style={{ fontSize: 8, color: "#2d4060", fontFamily: "monospace" }}>· {suggestion.source}</span>
        {suggestion.confidence > 0 && <span style={{ fontSize: 8, color: "#2d4060", fontFamily: "monospace" }}>{Math.round(suggestion.confidence * 100)}%</span>}
        <button onClick={() => setExpanded(x => !x)} style={{ background: "none", border: "none", fontSize: 8, color: "#2d4060", cursor: "pointer", fontFamily: "monospace" }}>{expanded ? "LESS" : "MORE"}</button>
        <div style={{ flex: 1 }} />
        {!done && (
          <button onClick={() => rejectSuggestion(suggestion.id)} style={{ fontSize: 8, fontFamily: "monospace", padding: "3px 8px", background: "transparent", border: "1px solid #1e2a3a", color: "#4b6080", borderRadius: 2, cursor: "pointer" }}>DISMISS</button>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   ALERTS PANEL
   ════════════════════════════════════════════════════════════════════ */

function AlertsPanel({ onOpenPlanner }: { onOpenPlanner: () => void }) {
  const suggestions     = useAIStore(s => s.suggestions);
  const isOpen          = useUIStore(s => s.alertsPanelOpen);
  const toggleAlerts    = useUIStore(s => s.toggleAlertsPanel);
  const robots          = useRobotStore(s => s.robots);
  const robotList       = Object.values(robots);

  if (!isOpen) return null;

  const sorted = Object.values(suggestions).sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return (order[a.severity] ?? 2) - (order[b.severity] ?? 2) || b.createdAt - a.createdAt;
  });

  const lowBatt   = robotList.filter(r => (r.health?.batteryPercent ?? 100) < 25 && r.status !== "offline");
  const offline   = robotList.filter(r => r.status === "offline");
  const pending   = sorted.filter(s => s.status === "pending").length;

  return (
    <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 294, background: "#060b13", borderLeft: "1px solid #0d1a28", display: "flex", flexDirection: "column", zIndex: 30 }}>
      <div style={{ padding: "9px 14px", borderBottom: "1px solid #0d1a28", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#2d4060", fontFamily: "monospace", letterSpacing: 2 }}>AI ALERTS</span>
          {pending > 0 && <span style={{ fontSize: 8, color: "#ef4444", fontFamily: "monospace" }}>{pending} PENDING</span>}
        </div>
        <button onClick={toggleAlerts} style={{ background: "none", border: "none", color: "#2d4060", cursor: "pointer", fontSize: 16 }}>×</button>
      </div>

      {lowBatt.length > 0 && (
        <div style={{ padding: "6px 14px", background: "rgba(245,158,11,0.05)", borderBottom: "1px solid rgba(245,158,11,0.08)", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 8, color: "#f59e0b", fontFamily: "monospace" }}>⚡</span>
          <span style={{ fontSize: 9, color: "#7a6030", fontFamily: "monospace" }}>LOW POWER: {lowBatt.map(r => r.name).join(", ")}</span>
        </div>
      )}
      {offline.length > 0 && (
        <div style={{ padding: "6px 14px", background: "rgba(239,68,68,0.05)", borderBottom: "1px solid rgba(239,68,68,0.08)", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 8, color: "#ef4444", fontFamily: "monospace" }}>◌</span>
          <span style={{ fontSize: 9, color: "#7a3030", fontFamily: "monospace" }}>COMMS LOST: {offline.map(r => r.name).join(", ")}</span>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto" }}>
        {sorted.map(s => <AlertCard key={s.id} suggestion={s} />)}
        {sorted.length === 0 && (
          <div style={{ padding: "20px", textAlign: "center" as const, fontSize: 9, color: "#2d4060", fontFamily: "monospace" }}>NO ACTIVE ALERTS</div>
        )}
      </div>

      <div style={{ padding: 12, borderTop: "1px solid #0d1a28" }}>
        <button onClick={onOpenPlanner}
          style={{ width: "100%", padding: "9px 0", background: "rgba(0,229,160,0.05)", border: "1px solid rgba(0,229,160,0.18)", color: "#00e5a0", fontFamily: "monospace", fontSize: 10, letterSpacing: 2, borderRadius: 3, cursor: "pointer" }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,229,160,0.1)"}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,229,160,0.05)"}
        >✦ MISSION PLANNER</button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   MISSION PLANNER MODAL
   ════════════════════════════════════════════════════════════════════ */

function MissionPlanner({ onClose }: { onClose: () => void }) {
  const [objective, setObjective] = useState("");
  const robots      = useRobotStore(s => s.robots);
  const robotList   = Object.values(robots);
  const generatePlan = useAIStore(s => s.generatePlan);
  const approvePlan  = useAIStore(s => s.approvePlan);
  const clearPlan    = useAIStore(s => s.clearPlan);
  const plan         = useAIStore(s => s.pendingPlan);
  const planLoading  = useAIStore(s => s.planLoading);
  const planError    = useAIStore(s => s.planError);
  const [approved, setApproved] = useState(false);

  const available = robotList.filter(r => r.status !== "offline");
  const offline   = robotList.filter(r => r.status === "offline");

  const handleGenerate = () => {
    if (!objective.trim()) return;
    const intent: MissionIntent = {
      objective,
      constraints: [],
      rulesOfEngagement: [],
      preferences: {},
    };
    generatePlan(intent);
  };

  const handleApprove = async () => {
    await approvePlan();
    setApproved(true);
  };

  const handleClose = () => {
    clearPlan();
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.78)" }}>
      <div style={{ width: 620, maxHeight: "85vh", background: "#060b13", border: "1px solid #0d1a28", borderRadius: 4, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #0d1a28", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace", letterSpacing: 1 }}>✦ MISSION PLANNER</div>
            <div style={{ fontSize: 9, color: "#2d4060", fontFamily: "monospace", marginTop: 3, letterSpacing: 1 }}>AI-ASSISTED TACTICAL PLANNING · {available.length} ASSETS AVAILABLE</div>
          </div>
          <button onClick={handleClose} style={{ background: "none", border: "none", color: "#2d4060", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

          {/* Objective */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 8, color: "#2d4060", fontFamily: "monospace", letterSpacing: 2, marginBottom: 6 }}>MISSION OBJECTIVE</div>
            <textarea value={objective} onChange={e => setObjective(e.target.value)}
              placeholder="Describe mission objective in plain language. e.g. 'Patrol the northern sector, identify unauthorized vehicles, and establish a hold at grid Bravo.'"
              rows={3}
              style={{ width: "100%", boxSizing: "border-box" as const, background: "#0a1520", border: "1px solid #0d1a28", color: "#94a3b8", fontFamily: "monospace", fontSize: 11, padding: "10px 12px", borderRadius: 3, outline: "none", resize: "vertical" as const, lineHeight: 1.6 }}
            />
          </div>

          {/* Assets */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 8, color: "#2d4060", fontFamily: "monospace", letterSpacing: 2, marginBottom: 6 }}>AVAILABLE ASSETS</div>
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5 }}>
              {available.map(r => (
                <div key={r.id} style={{ padding: "4px 8px", border: "1px solid #0d1a28", background: "#0a1520", borderRadius: 2, display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ color: TYPE_COLOR[r.robotType], fontSize: 9 }}>{TYPE_ICON[r.robotType]}</span>
                  <span style={{ fontSize: 9, color: "#4b6080", fontFamily: "monospace" }}>{r.name}</span>
                  <span style={{ fontSize: 8, color: (r.health?.batteryPercent ?? 0) > 50 ? "#00e5a0" : "#f59e0b", fontFamily: "monospace" }}>{Math.round(r.health?.batteryPercent ?? 0)}%</span>
                </div>
              ))}
              {offline.map(r => (
                <div key={r.id} style={{ padding: "4px 8px", border: "1px solid #1a2030", borderRadius: 2, display: "flex", alignItems: "center", gap: 5, opacity: 0.35 }}>
                  <span style={{ color: "#4b5563", fontSize: 9 }}>{TYPE_ICON[r.robotType]}</span>
                  <span style={{ fontSize: 9, color: "#2d4060", fontFamily: "monospace" }}>{r.name} OFFLINE</span>
                </div>
              ))}
            </div>
          </div>

          {/* Error */}
          {planError && (
            <div style={{ padding: "9px 12px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 3, marginBottom: 12 }}>
              <span style={{ fontSize: 10, color: "#ef4444", fontFamily: "monospace" }}>{planError}</span>
            </div>
          )}

          {/* Plan output */}
          {plan && !approved && (
            <div>
              <div style={{ fontSize: 8, color: "#2d4060", fontFamily: "monospace", letterSpacing: 2, marginBottom: 8, borderBottom: "1px solid #0d1a28", paddingBottom: 5 }}>GENERATED PLAN</div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600, fontFamily: "monospace" }}>{plan.name}</span>
                  <span style={{ fontSize: 9, color: "#4b6080", fontFamily: "monospace" }}>EST. {plan.estimatedDurationMinutes} MIN</span>
                </div>
              </div>

              {plan.assignments?.map((a, i) => (
                <div key={i} style={{ padding: "10px 12px", background: "#0a1520", border: "1px solid #0d1a28", borderRadius: 3, marginBottom: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: "#e2e8f0", fontFamily: "monospace", fontWeight: 600 }}>{a.robotId}</span>
                    <span style={{ fontSize: 8, color: "#38bdf8", fontFamily: "monospace", padding: "1px 6px", background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 2 }}>{a.role}</span>
                  </div>
                  <p style={{ fontSize: 10, color: "#4b6080", fontFamily: "monospace", lineHeight: 1.5, marginBottom: 4 }}>{a.rationale}</p>
                  {a.waypoints?.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const }}>
                      {a.waypoints.map((wp, j) => (
                        <span key={j} style={{ fontSize: 8, color: "#00e5a0", fontFamily: "monospace", padding: "1px 5px", background: "rgba(0,229,160,0.06)", border: "1px solid rgba(0,229,160,0.15)", borderRadius: 2 }}>
                          WP{j + 1}: {wp.latitude.toFixed(4)}, {wp.longitude.toFixed(4)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {plan.contingencies?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 8, color: "#2d4060", fontFamily: "monospace", letterSpacing: 2, marginBottom: 6 }}>CONTINGENCIES</div>
                  {plan.contingencies.map((c, i) => (
                    <div key={i} style={{ padding: "8px 10px", background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.12)", borderRadius: 3, marginBottom: 4 }}>
                      <span style={{ fontSize: 9, color: "#f59e0b", fontFamily: "monospace" }}>IF: </span>
                      <span style={{ fontSize: 9, color: "#4b6080", fontFamily: "monospace" }}>{c.trigger}</span>
                      <br />
                      <span style={{ fontSize: 9, color: "#38bdf8", fontFamily: "monospace" }}>→ </span>
                      <span style={{ fontSize: 9, color: "#4b6080", fontFamily: "monospace" }}>{c.action}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {approved && (
            <div style={{ padding: "14px", background: "rgba(0,229,160,0.05)", border: "1px solid rgba(0,229,160,0.2)", borderRadius: 3, textAlign: "center" as const }}>
              <div style={{ fontSize: 12, color: "#00e5a0", fontFamily: "monospace", marginBottom: 4 }}>✓ MISSION DEPLOYED</div>
              <div style={{ fontSize: 9, color: "#2d6050", fontFamily: "monospace" }}>Plan approved and dispatched to fleet.</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "11px 20px", borderTop: "1px solid #0d1a28", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={handleClose} style={{ padding: "7px 16px", fontSize: 9, fontFamily: "monospace", letterSpacing: 1, background: "transparent", border: "1px solid #1e2a3a", color: "#4b6080", borderRadius: 3, cursor: "pointer" }}>
            {approved ? "CLOSE" : "CANCEL"}
          </button>
          {!approved && plan && (
            <button onClick={() => { clearPlan(); }} style={{ padding: "7px 14px", fontSize: 9, fontFamily: "monospace", letterSpacing: 1, background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.2)", color: "#38bdf8", borderRadius: 3, cursor: "pointer" }}>
              REGENERATE
            </button>
          )}
          {!approved && !plan && !planLoading && (
            <button onClick={handleGenerate} disabled={!objective.trim()} style={{ padding: "7px 18px", fontSize: 9, fontFamily: "monospace", letterSpacing: 1, background: objective.trim() ? "rgba(0,229,160,0.09)" : "transparent", border: `1px solid ${objective.trim() ? "rgba(0,229,160,0.3)" : "#1e2a3a"}`, color: objective.trim() ? "#00e5a0" : "#2d4060", borderRadius: 3, cursor: objective.trim() ? "pointer" : "not-allowed", transition: "all 0.15s" }}>
              GENERATE PLAN
            </button>
          )}
          {!approved && planLoading && (
            <button disabled style={{ padding: "7px 18px", fontSize: 9, fontFamily: "monospace", letterSpacing: 1, background: "transparent", border: "1px solid #1e2a3a", color: "#2d4060", borderRadius: 3, cursor: "not-allowed" }}>
              GENERATING...
            </button>
          )}
          {!approved && plan && (
            <button onClick={handleApprove} style={{ padding: "7px 18px", fontSize: 9, fontFamily: "monospace", letterSpacing: 1, background: "rgba(0,229,160,0.09)", border: "1px solid rgba(0,229,160,0.3)", color: "#00e5a0", borderRadius: 3, cursor: "pointer" }}>
              APPROVE & DEPLOY
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   LEFT SIDEBAR
   ════════════════════════════════════════════════════════════════════ */

function RobotListPanel() {
  const robots      = useRobotStore(s => s.robots);
  const robotList   = Object.values(robots);
  const selectedId  = useUIStore(s => s.selectedRobotId);
  const selectRobot = useUIStore(s => s.selectRobot);
  const searchQuery = useUIStore(s => s.searchQuery);
  const setSearch   = useUIStore(s => s.setSearchQuery);

  const [filterType, setFilterType] = useState<"all" | "drone" | "ground" | "underwater">("all");

  const filtered = robotList.filter(r => {
    if (filterType !== "all" && r.robotType !== filterType) return false;
    if (searchQuery && !r.name.toLowerCase().includes(searchQuery.toLowerCase()) && !r.id.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <aside style={{ width: 240, background: "#060b13", borderRight: "1px solid #0d1a28", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ padding: "9px 14px", borderBottom: "1px solid #0d1a28", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 9, color: "#2d4060", fontFamily: "monospace", letterSpacing: 2 }}>FLEET</span>
        <span style={{ fontSize: 9, color: "#2d4060", fontFamily: "monospace" }}>{robotList.length} UNITS</span>
      </div>
      <FleetStats robots={robotList} />
      <div style={{ padding: "8px 10px", borderBottom: "1px solid #0d1a28" }}>
        <input value={searchQuery} onChange={e => setSearch(e.target.value)} placeholder="SEARCH UNIT..."
          style={{ width: "100%", boxSizing: "border-box" as const, background: "#0a1520", border: "1px solid #0d1a28", color: "#94a3b8", fontFamily: "monospace", fontSize: 10, padding: "5px 8px", borderRadius: 3, outline: "none", letterSpacing: 1 }}
        />
        <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
          {([["all","ALL"],["drone","UAV"],["ground","GRV"],["underwater","UUV"]] as const).map(([val, lbl]) => (
            <button key={val} onClick={() => setFilterType(val as any)} style={{ flex: 1, padding: "3px 0", fontSize: 7, fontFamily: "monospace", letterSpacing: 0.5, background: filterType === val ? "rgba(0,229,160,0.08)" : "#0a1520", border: `1px solid ${filterType === val ? "rgba(0,229,160,0.3)" : "#0d1a28"}`, color: filterType === val ? "#00e5a0" : "#2d4060", borderRadius: 2, cursor: "pointer" }}>{lbl}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filtered.map(r => (
          <RobotRow key={r.id} robot={r} selected={selectedId === r.id} onClick={() => selectRobot(selectedId === r.id ? null : r.id)} />
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: "20px", textAlign: "center" as const, fontSize: 9, color: "#2d4060", fontFamily: "monospace" }}>NO UNITS MATCH</div>
        )}
      </div>
    </aside>
  );
}

/* ════════════════════════════════════════════════════════════════════
   HEADER
   ════════════════════════════════════════════════════════════════════ */

function HeaderBar() {
  const connected       = useConnectionStore(s => s.connected);
  const reconnecting    = useConnectionStore(s => s.reconnecting);
  const alertsPanelOpen = useUIStore(s => s.alertsPanelOpen);
  const toggleAlerts    = useUIStore(s => s.toggleAlertsPanel);
  const suggestions     = useAIStore(s => s.suggestions);
  const pendingAlerts   = Object.values(suggestions).filter(s => s.status === "pending").length;
  const commandMode     = useUIStore(s => s.commandMode);
  const setCommandMode  = useUIStore(s => s.setCommandMode);

  return (
    <header style={{ height: 44, display: "flex", alignItems: "center", padding: "0 18px", background: "#060b13", borderBottom: "1px solid #0d1a28", flexShrink: 0, gap: 18, zIndex: 100 }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 22, height: 22, border: "1.5px solid #00e5a0", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" as const }}>
          <div style={{ width: 8, height: 8, background: "#00e5a0", transform: "rotate(45deg)" }} />
          <div style={{ position: "absolute" as const, top: -1, left: -1, right: -1, bottom: -1, border: "1px solid rgba(0,229,160,0.3)", transform: "rotate(15deg)" }} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 3, color: "#e2e8f0", fontFamily: "monospace" }}>ARGUS</span>
        <span style={{ fontSize: 9, color: "#2d4060", fontFamily: "monospace", letterSpacing: 2 }}>GCS v2.4</span>
      </div>

      <div style={{ flex: 1 }} />

      {/* System status */}
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <StatusPill label="DATALINK" active={connected} />
        <StatusPill label="CORTEX"   active={!reconnecting} />
        <StatusPill label="GEODATA"  active />
      </div>

      {/* Command mode exit banner (inline) */}
      {commandMode !== "none" && (
        <>
          <div style={{ width: 1, height: 20, background: "#0d1a28" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 10px", background: "rgba(0,229,160,0.06)", border: "1px solid rgba(0,229,160,0.2)", borderRadius: 3 }}>
            <span style={{ fontSize: 9, color: "#00e5a0", fontFamily: "monospace", letterSpacing: 1 }}>
              ▸ {commandMode === "set_waypoints" ? "ADDING WAYPOINTS" : commandMode.replace("_", " ").toUpperCase()}
            </span>
            <button onClick={() => setCommandMode("none")} style={{ fontSize: 8, fontFamily: "monospace", padding: "1px 7px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", borderRadius: 2, cursor: "pointer" }}>
              EXIT [ESC]
            </button>
          </div>
        </>
      )}

      <div style={{ width: 1, height: 20, background: "#0d1a28" }} />
      <LiveClock />
      <div style={{ width: 1, height: 20, background: "#0d1a28" }} />

      <button onClick={toggleAlerts} style={{ background: alertsPanelOpen ? "rgba(0,229,160,0.06)" : "transparent", border: `1px solid ${alertsPanelOpen ? "rgba(0,229,160,0.2)" : "#0d1a28"}`, color: "#4b6080", padding: "3px 12px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", fontSize: 10, display: "flex", alignItems: "center", gap: 8, letterSpacing: 1 }}>
        ALERTS
        {pendingAlerts > 0 && <span style={{ background: "#ef4444", color: "#fff", fontSize: 8, fontWeight: 700, fontFamily: "monospace", padding: "1px 5px", borderRadius: 2 }}>{pendingAlerts}</span>}
      </button>
    </header>
  );
}

/* ════════════════════════════════════════════════════════════════════
   ROOT APP
   ════════════════════════════════════════════════════════════════════ */

export default function App() {
  useWebSocket();
  useKeyboardShortcuts();

  const [plannerOpen, setPlannerOpen] = useState(false);
  const [followedId, setFollowedId]  = useState<string | null>(null);
  const selectedId    = useUIStore(s => s.selectedRobotId);
  const robots        = useRobotStore(s => s.robots);
  const selectedRobot = selectedId ? robots[selectedId] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#050a10", color: "#c8d6e5", fontFamily: "system-ui, sans-serif", overflow: "hidden" }}>
      <HeaderBar />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <RobotListPanel />
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <MapView followedId={followedId} />
          {selectedRobot && <DetailPanel robot={selectedRobot} followedId={followedId} onFollowToggle={setFollowedId} />}
          <AlertsPanel onOpenPlanner={() => setPlannerOpen(true)} />
        </div>
      </div>
      {plannerOpen && <MissionPlanner onClose={() => setPlannerOpen(false)} />}
    </div>
  );
}
