import React, { useState, useMemo, useCallback, useRef, useEffect, Component, type ReactNode } from "react";
import Map, { NavigationControl, Marker, Source, Layer, type MapRef, type MapLayerMouseEvent, type LayerProps } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { Radio, AlertCircle, Bell, Settings, Plane, Search, Filter, ChevronDown, Sparkles, Menu, X, Plus, CheckCircle2, AlertTriangle, Phone, Home, MapPin, CircleDot, Undo2, Trash2, Send } from "lucide-react";
import clsx from "clsx";

import {
  useWebSocket,
  useKeyboardShortcuts,
  useRobotStore,
  useUIStore,
  useConnectionStore,
  useCommandStore,
  useMissionStore,
  useAIStore,
  useAutonomyStore,
} from "./lib";
import type { RobotState, RobotStatus, RobotType, AutonomyTier, Suggestion, MissionIntent, Waypoint } from "./lib";

/* ════════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ════════════════════════════════════════════════════════════════════════════ */

const DEFAULT_CENTER = { longitude: -121.9886, latitude: 37.5485 }; // Fremont, CA
const DEFAULT_ZOOM = 15;

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
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    },
  },
  layers: [
    {
      id: "carto-dark-layer",
      type: "raster" as const,
      source: "carto-dark",
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

const ROBOT_COLORS: Record<string, string> = {
  drone: "#22c55e",
  ground: "#a78bfa",
  underwater: "#38bdf8",
};

const EMPTY_IDS: string[] = [];

/* ════════════════════════════════════════════════════════════════════════════
   AUTONOMY BADGE
   ════════════════════════════════════════════════════════════════════════════ */

const BADGE_CONFIG: Record<AutonomyTier, { label: string; bg: string; text: string }> = {
  manual: { label: "MAN", bg: "bg-slate-500/15 border-slate-500/30", text: "text-slate-400" },
  assisted: { label: "AST", bg: "bg-sky-500/15 border-sky-500/30", text: "text-sky-400" },
  supervised: { label: "SUP", bg: "bg-amber-500/15 border-amber-500/30", text: "text-amber-400" },
  autonomous: { label: "AUT", bg: "bg-emerald-500/15 border-emerald-500/30", text: "text-emerald-400" },
};

function AutonomyBadge({ tier, size = "sm" }: { tier: AutonomyTier; size?: "sm" | "md" }) {
  const config = BADGE_CONFIG[tier] ?? BADGE_CONFIG.assisted;
  const sizeClasses = size === "sm" ? "text-[9px] px-1.5 py-0" : "text-[11px] px-2 py-0.5";
  return (
    <span className={`font-bold tracking-wider rounded-full border ${config.bg} ${config.text} ${sizeClasses}`}>
      {config.label}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   AUTHORITY INDICATOR
   ════════════════════════════════════════════════════════════════════════════ */

function AuthorityIndicator({ source, timestamp }: { source: string; timestamp: number }) {
  if (!source) return null;
  const isAI = source === "ai";
  const isVoice = source === "voice";
  const elapsed = timestamp > 0 ? Math.round(Date.now() / 1000 - timestamp) : 0;
  const timeAgo =
    elapsed < 60 ? `${elapsed}s ago` : elapsed < 3600 ? `${Math.floor(elapsed / 60)}m ago` : `${Math.floor(elapsed / 3600)}h ago`;

  const badgeStyle = isVoice
    ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
    : isAI
      ? "bg-violet-500/15 border-violet-500/30 text-violet-400"
      : "bg-sky-500/15 border-sky-500/30 text-sky-400";
  const label = isVoice ? "Voice" : isAI ? "AI" : "Operator";

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-slate-500">Last control:</span>
      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border flex items-center gap-1 ${badgeStyle}`}>
        {isVoice && <Phone className="w-3 h-3" />}
        {label}
      </span>
      {timestamp > 0 && <span className="text-[11px] text-slate-600">{timeAgo}</span>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   AUTONOMY TIER SELECTOR
   ════════════════════════════════════════════════════════════════════════════ */

const TIERS: { value: AutonomyTier; label: string; color: string; activeColor: string }[] = [
  { value: "manual", label: "MAN", color: "text-slate-500", activeColor: "bg-slate-500/20 text-slate-300 border-slate-500/40" },
  { value: "assisted", label: "AST", color: "text-slate-500", activeColor: "bg-sky-500/20 text-sky-300 border-sky-500/40" },
  { value: "supervised", label: "SUP", color: "text-slate-500", activeColor: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  { value: "autonomous", label: "AUT", color: "text-slate-500", activeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
];

function AutonomyTierSelector({ robotId, currentTier }: { robotId: string; currentTier: AutonomyTier }) {
  const setRobotTier = useAutonomyStore((s) => s.setRobotTier);
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Autonomy Tier</div>
      <div className="flex gap-1">
        {TIERS.map((t) => {
          const isActive = currentTier === t.value;
          return (
            <button
              key={t.value}
              onClick={() => { if (!isActive) setRobotTier(robotId, t.value); }}
              className={`flex-1 text-[11px] font-bold tracking-wide py-1.5 rounded-lg border transition-all duration-150 ${
                isActive ? t.activeColor : "border-transparent hover:bg-slate-800/60 " + t.color
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   COUNTDOWN TIMER
   ════════════════════════════════════════════════════════════════════════════ */

function CountdownTimer({ suggestionId, autoExecuteAt }: { suggestionId: string; autoExecuteAt: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, autoExecuteAt - Date.now() / 1000));
  const totalDuration = useRef(Math.max(1, autoExecuteAt - Date.now() / 1000));
  const rafRef = useRef(0);
  const reject = useAIStore((s) => s.rejectSuggestion);
  const removeCountdown = useAutonomyStore((s) => s.removeCountdown);

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, autoExecuteAt - Date.now() / 1000);
      setRemaining(left);
      if (left > 0) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [autoExecuteAt]);

  const handleOverride = () => {
    reject(suggestionId);
    removeCountdown(suggestionId);
  };

  const pct = remaining / totalDuration.current;
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);

  return (
    <div className="flex items-center gap-2.5">
      <div className="relative w-10 h-10 flex-shrink-0">
        <svg width="40" height="40" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r={radius} fill="none" stroke="#3f3f46" strokeWidth="3" />
          <circle
            cx="20" cy="20" r={radius} fill="none" stroke="#f59e0b" strokeWidth="3"
            strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset}
            transform="rotate(-90 20 20)" className="transition-[stroke-dashoffset] duration-100"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-amber-400">
          {Math.ceil(remaining)}
        </span>
      </div>
      <button
        onClick={handleOverride}
        className="text-[11px] px-2.5 py-1 rounded-lg bg-rose-600/80 text-white hover:bg-rose-500 transition-colors"
      >
        Override
      </button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   COMMAND PALETTE
   ════════════════════════════════════════════════════════════════════════════ */

interface CommandDef {
  label: string;
  command: string;
  color: string;
  hoverColor: string;
  borderColor: string;
}

const DRONE_COMMANDS: CommandDef[] = [
  { label: "Go To Location", command: "goto", color: "bg-sky-500/10 text-sky-400", hoverColor: "hover:bg-sky-500/20", borderColor: "border-sky-500/20" },
  { label: "Patrol", command: "patrol", color: "bg-emerald-500/10 text-emerald-400", hoverColor: "hover:bg-emerald-500/20", borderColor: "border-emerald-500/20" },
  { label: "Waypoints", command: "set_waypoints", color: "bg-indigo-500/10 text-indigo-400", hoverColor: "hover:bg-indigo-500/20", borderColor: "border-indigo-500/20" },
  { label: "Circle Area", command: "circle_area", color: "bg-pink-500/10 text-pink-400", hoverColor: "hover:bg-pink-500/20", borderColor: "border-pink-500/20" },
  { label: "Set Home", command: "set_home", color: "bg-amber-500/10 text-amber-400", hoverColor: "hover:bg-amber-500/20", borderColor: "border-amber-500/20" },
  { label: "Hold Position", command: "stop", color: "bg-violet-500/10 text-violet-400", hoverColor: "hover:bg-violet-500/20", borderColor: "border-violet-500/20" },
  { label: "Return Home", command: "return_home", color: "bg-orange-500/10 text-orange-400", hoverColor: "hover:bg-orange-500/20", borderColor: "border-orange-500/20" },
];

const GROUND_COMMANDS: CommandDef[] = [
  { label: "Go To Location", command: "goto", color: "bg-sky-500/10 text-sky-400", hoverColor: "hover:bg-sky-500/20", borderColor: "border-sky-500/20" },
  { label: "Patrol", command: "patrol", color: "bg-emerald-500/10 text-emerald-400", hoverColor: "hover:bg-emerald-500/20", borderColor: "border-emerald-500/20" },
  { label: "Waypoints", command: "set_waypoints", color: "bg-indigo-500/10 text-indigo-400", hoverColor: "hover:bg-indigo-500/20", borderColor: "border-indigo-500/20" },
  { label: "Circle Area", command: "circle_area", color: "bg-pink-500/10 text-pink-400", hoverColor: "hover:bg-pink-500/20", borderColor: "border-pink-500/20" },
  { label: "Set Home", command: "set_home", color: "bg-amber-500/10 text-amber-400", hoverColor: "hover:bg-amber-500/20", borderColor: "border-amber-500/20" },
  { label: "Stop", command: "stop", color: "bg-rose-500/10 text-rose-400", hoverColor: "hover:bg-rose-500/20", borderColor: "border-rose-500/20" },
  { label: "Return to Base", command: "return_home", color: "bg-orange-500/10 text-orange-400", hoverColor: "hover:bg-orange-500/20", borderColor: "border-orange-500/20" },
];

const UNDERWATER_COMMANDS: CommandDef[] = [
  { label: "Go To Location", command: "goto", color: "bg-sky-500/10 text-sky-400", hoverColor: "hover:bg-sky-500/20", borderColor: "border-sky-500/20" },
  { label: "Patrol", command: "patrol", color: "bg-emerald-500/10 text-emerald-400", hoverColor: "hover:bg-emerald-500/20", borderColor: "border-emerald-500/20" },
  { label: "Waypoints", command: "set_waypoints", color: "bg-indigo-500/10 text-indigo-400", hoverColor: "hover:bg-indigo-500/20", borderColor: "border-indigo-500/20" },
  { label: "Circle Area", command: "circle_area", color: "bg-pink-500/10 text-pink-400", hoverColor: "hover:bg-pink-500/20", borderColor: "border-pink-500/20" },
  { label: "Set Home", command: "set_home", color: "bg-amber-500/10 text-amber-400", hoverColor: "hover:bg-amber-500/20", borderColor: "border-amber-500/20" },
  { label: "Surface", command: "surface", color: "bg-teal-500/10 text-teal-400", hoverColor: "hover:bg-teal-500/20", borderColor: "border-teal-500/20" },
  { label: "Return Home", command: "return_home", color: "bg-orange-500/10 text-orange-400", hoverColor: "hover:bg-orange-500/20", borderColor: "border-orange-500/20" },
];

const COMMANDS_BY_TYPE: Record<RobotType, CommandDef[]> = {
  drone: DRONE_COMMANDS,
  ground: GROUND_COMMANDS,
  underwater: UNDERWATER_COMMANDS,
};

const MAP_MODES = new Set(["goto", "set_home", "set_waypoints", "circle_area"]);

function CommandPalette({ robotId, robotType }: { robotId: string; robotType: RobotType }) {
  const sendCommand = useCommandStore((s) => s.sendCommand);
  const setCommandMode = useUIStore((s) => s.setCommandMode);
  const commandMode = useUIStore((s) => s.commandMode);
  const commands = COMMANDS_BY_TYPE[robotType] || DRONE_COMMANDS;

  const handleCommand = (cmd: CommandDef) => {
    if (MAP_MODES.has(cmd.command)) {
      const currentMode = useUIStore.getState().commandMode;
      setCommandMode(currentMode === cmd.command ? "none" : cmd.command as any);
      return;
    }
    console.log(`[Command] ${cmd.label} → robot=${robotId}, type=${cmd.command}`);
    sendCommand(robotId, cmd.command);
  };

  const modeLabels: Record<string, string> = {
    goto: "Click Map...",
    set_home: "Click Map...",
    set_waypoints: "Adding...",
    circle_area: "Click Map...",
  };
  const modeActiveColors: Record<string, string> = {
    goto: "bg-sky-500/20 text-sky-300 border-sky-500/40 ring-1 ring-sky-500/20",
    set_home: "bg-amber-500/20 text-amber-300 border-amber-500/40 ring-1 ring-amber-500/20",
    set_waypoints: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40 ring-1 ring-indigo-500/20",
    circle_area: "bg-pink-500/20 text-pink-300 border-pink-500/40 ring-1 ring-pink-500/20",
  };
  const modeHints: Record<string, string> = {
    goto: "Click on the map to set destination",
    set_home: "Click on the map to set new home position",
    set_waypoints: "Click on the map to add waypoints, then send",
    circle_area: "Click on the map to set circle center",
  };

  return (
    <div className="space-y-2.5">
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Commands</div>
      <div className="grid grid-cols-2 gap-2">
        {commands.map((cmd) => {
          const isActive = MAP_MODES.has(cmd.command) && commandMode === cmd.command;
          return (
            <button
              key={cmd.command}
              onClick={() => handleCommand(cmd)}
              className={`px-3 py-2 text-[13px] font-medium rounded-xl border transition-colors ${
                isActive
                  ? modeActiveColors[cmd.command] ?? ""
                  : `${cmd.color} ${cmd.hoverColor} ${cmd.borderColor}`
              }`}
            >
              {isActive ? modeLabels[cmd.command] ?? cmd.label : cmd.label}
            </button>
          );
        })}
      </div>
      {commandMode !== "none" && modeHints[commandMode] && (
        <div className="text-[13px] text-sky-400/80 animate-pulse">{modeHints[commandMode]}</div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   COMMAND HISTORY
   ════════════════════════════════════════════════════════════════════════════ */

const CMD_STATUS_PILLS: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "bg-amber-500/15 border-amber-500/30", text: "text-amber-400", label: "Pending" },
  sent: { bg: "bg-sky-500/15 border-sky-500/30", text: "text-sky-400", label: "Sent" },
  acknowledged: { bg: "bg-amber-500/15 border-amber-500/30", text: "text-amber-400", label: "Pending" },
  completed: { bg: "bg-emerald-500/15 border-emerald-500/30", text: "text-emerald-400", label: "Completed" },
  failed: { bg: "bg-rose-500/15 border-rose-500/30", text: "text-rose-400", label: "Failed" },
};

function CommandHistory({ robotId }: { robotId: string }) {
  const commands = useCommandStore((s) => s.commands);
  const robotCommandIds = useCommandStore((s) => s.robotCommands[robotId] ?? EMPTY_IDS);
  const recentIds = robotCommandIds.slice(-5).reverse();
  const recentCommands = recentIds.map((id) => commands[id]).filter((c): c is NonNullable<typeof c> => c != null);

  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Recent Commands</div>
      {recentCommands.length === 0 ? (
        <div className="text-[13px] text-slate-600 py-3 text-center">No recent commands</div>
      ) : (
        <div className="space-y-1.5">
          {recentCommands.map((cmd) => {
            const pill = (CMD_STATUS_PILLS[cmd.status] || CMD_STATUS_PILLS.pending)!;
            const params =
              cmd.parameters && Object.keys(cmd.parameters).length > 0
                ? Object.entries(cmd.parameters)
                    .map(([k, v]) => `${k}: ${typeof v === "number" ? (v as number).toFixed(2) : v}`)
                    .join(", ")
                : null;
            return (
              <div key={cmd.id} className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-slate-800/40">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-slate-300 font-mono truncate">{cmd.commandType}</div>
                  {params && <div className="text-[11px] text-slate-600 truncate mt-0.5">{params}</div>}
                </div>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border flex-shrink-0 ml-2 ${pill.bg} ${pill.text}`}>
                  {pill.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   FLEET STATS PANEL
   ════════════════════════════════════════════════════════════════════════════ */

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
      <div className="text-[11px] text-slate-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-slate-500 w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-slate-400 w-8 text-right">{value}</span>
    </div>
  );
}

function BatteryBurnDown({ robots }: { robots: RobotState[] }) {
  const sorted = [...robots].sort((a, b) => (a.health?.batteryPercent ?? 0) - (b.health?.batteryPercent ?? 0));
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Battery Levels</div>
      <div className="space-y-1">
        {sorted.map((r) => {
          const batt = r.health?.batteryPercent ?? 0;
          const color = batt > 50 ? "bg-emerald-500" : batt > 20 ? "bg-amber-500" : "bg-rose-500";
          const minsLeft = batt <= 15 ? 0 : Math.round((batt - 15) * 1.2);
          return (
            <div key={r.id} className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 w-14 truncate shrink-0">{r.name}</span>
              <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${batt}%` }} />
              </div>
              <span className={clsx("text-[10px] w-12 text-right", batt < 25 ? "text-rose-400" : "text-slate-400")}>
                {batt.toFixed(0)}%
              </span>
              <span className="text-[9px] text-slate-600 w-10 text-right">{minsLeft > 0 ? `~${minsLeft}m` : "crit"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MissionTimeline() {
  const missions = useMissionStore((s) => s.missions);
  const missionList = Object.values(missions);
  if (missionList.length === 0) {
    return (
      <div>
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Missions</div>
        <div className="text-[11px] text-slate-600 text-center py-4">No missions yet</div>
      </div>
    );
  }
  const statusColor: Record<string, string> = { active: "bg-emerald-500", paused: "bg-amber-500", completed: "bg-sky-500", aborted: "bg-rose-500", draft: "bg-slate-600" };
  const sorted = [...missionList].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Missions</div>
      <div className="space-y-1.5">
        {sorted.map((m) => {
          const totalWps = Object.values(m.waypoints ?? {}).reduce((sum, wps) => sum + wps.length, 0);
          const completedWps = Object.values(m.waypoints ?? {}).reduce((sum, wps) => sum + wps.filter((w) => w.status === "completed").length, 0);
          const pct = totalWps > 0 ? Math.round((completedWps / totalWps) * 100) : 0;
          return (
            <div key={m.id} className="bg-slate-800/40 rounded-lg p-2.5 border border-slate-700/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-slate-300 font-medium truncate">{m.name}</span>
                <span className={clsx("text-[9px] px-1.5 py-0.5 rounded-full capitalize", statusColor[m.status] ?? "bg-slate-600", "text-white")}>{m.status}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-sky-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] text-slate-500">{pct}%</span>
              </div>
              <div className="text-[10px] text-slate-600 mt-1">{m.assignedRobots?.length ?? 0} robots, {completedWps}/{totalWps} waypoints</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AIHistory() {
  const suggestions = useAIStore((s) => s.suggestions);
  const changeLog = useAutonomyStore((s) => s.changeLog);
  const allSuggestions = Object.values(suggestions);
  const approved = allSuggestions.filter((s) => s.status === "approved").length;
  const rejected = allSuggestions.filter((s) => s.status === "rejected").length;
  const pending = allSuggestions.filter((s) => s.status === "pending").length;
  const total = allSuggestions.length;
  const recentChanges = changeLog.slice(-5).reverse();

  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">AI Activity</div>
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        <div className="bg-slate-800/50 rounded-md p-2 text-center border border-slate-700/30">
          <div className="text-sm font-bold text-slate-100">{total}</div>
          <div className="text-[9px] text-slate-500">Total</div>
        </div>
        <div className="bg-slate-800/50 rounded-md p-2 text-center border border-slate-700/30">
          <div className="text-sm font-bold text-emerald-400">{approved}</div>
          <div className="text-[9px] text-slate-500">Approved</div>
        </div>
        <div className="bg-slate-800/50 rounded-md p-2 text-center border border-slate-700/30">
          <div className="text-sm font-bold text-rose-400">{rejected}</div>
          <div className="text-[9px] text-slate-500">Rejected</div>
        </div>
        <div className="bg-slate-800/50 rounded-md p-2 text-center border border-slate-700/30">
          <div className="text-sm font-bold text-amber-400">{pending}</div>
          <div className="text-[9px] text-slate-500">Pending</div>
        </div>
      </div>
      {approved + rejected > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-slate-500">Acceptance Rate</span>
            <span className="text-slate-300">{Math.round((approved / (approved + rejected)) * 100)}%</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${(approved / (approved + rejected)) * 100}%` }} />
            <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${(rejected / (approved + rejected)) * 100}%` }} />
          </div>
        </div>
      )}
      {recentChanges.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-500 mb-1.5">Recent Tier Changes</div>
          <div className="space-y-1">
            {recentChanges.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 text-[10px]">
                <span className="text-slate-500 w-16 truncate">{entry.robotId === "__fleet__" ? "Fleet" : entry.robotId.slice(0, 8)}</span>
                <span className="text-slate-600">{entry.oldTier}</span>
                <span className="text-slate-500">{"\u2192"}</span>
                <span className="text-slate-300">{entry.newTier}</span>
                <span className="text-slate-600 ml-auto">{entry.changedBy}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FleetStatsPanel() {
  const robots = useRobotStore((s) => s.robots);
  const robotList = useMemo(() => Object.values(robots), [robots]);
  const total = robotList.length;

  if (total === 0) {
    return <div className="text-[13px] text-slate-500 text-center py-10">No fleet data available</div>;
  }

  const byStatus = robotList.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const byType = robotList.reduce<Record<string, number>>((acc, r) => { acc[r.robotType] = (acc[r.robotType] || 0) + 1; return acc; }, {});
  const avgBattery = robotList.reduce((sum, r) => sum + (r.health?.batteryPercent ?? 0), 0) / total;
  const lowBattery = robotList.filter((r) => (r.health?.batteryPercent ?? 100) < 25).length;
  const avgSignal = robotList.reduce((sum, r) => sum + (r.health?.signalStrength ?? 0), 0) / total;
  const avgSpeed = robotList.filter((r: RobotState) => r.status === "active").reduce((sum, r) => sum + (r.speed ?? 0), 0) / Math.max(1, byStatus.active ?? 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Fleet Size" value={String(total)} color="text-slate-100" />
        <StatCard label="Avg Battery" value={`${avgBattery.toFixed(0)}%`} sub={lowBattery > 0 ? `${lowBattery} low` : undefined} color={avgBattery > 50 ? "text-emerald-400" : avgBattery > 25 ? "text-amber-400" : "text-rose-400"} />
        <StatCard label="Avg Signal" value={`${avgSignal.toFixed(0)}%`} color="text-sky-400" />
        <StatCard label="Avg Speed" value={`${avgSpeed.toFixed(1)}`} sub="m/s (active)" color="text-slate-100" />
      </div>
      <div>
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Status</div>
        <div className="space-y-1.5">
          <MiniBar label="Active" value={byStatus.active ?? 0} max={total} color="bg-emerald-500" />
          <MiniBar label="Idle" value={byStatus.idle ?? 0} max={total} color="bg-sky-500" />
          <MiniBar label="Returning" value={byStatus.returning ?? 0} max={total} color="bg-amber-500" />
          <MiniBar label="Error" value={byStatus.error ?? 0} max={total} color="bg-rose-500" />
          <MiniBar label="Offline" value={byStatus.offline ?? 0} max={total} color="bg-slate-500" />
        </div>
      </div>
      <div>
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Composition</div>
        <div className="space-y-1.5">
          <MiniBar label="Drones" value={byType.drone ?? 0} max={total} color="bg-emerald-500" />
          <MiniBar label="Rovers" value={byType.ground ?? 0} max={total} color="bg-violet-500" />
          <MiniBar label="UUVs" value={byType.underwater ?? 0} max={total} color="bg-cyan-500" />
        </div>
      </div>
      <BatteryBurnDown robots={robotList} />
      <MissionTimeline />
      <AIHistory />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   DETAIL DRAWER (with error boundary)
   ════════════════════════════════════════════════════════════════════════════ */

interface EBProps { children: ReactNode }
interface EBState { hasError: boolean; error: string }

class DetailErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { hasError: false, error: "" };
  static getDerivedStateFromError(err: Error) { return { hasError: true, error: err.message }; }
  componentDidCatch(error: Error) { console.error("[DetailPopup] Render error:", error); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute top-4 left-4 w-[320px] z-30 p-4 text-[13px] text-rose-400 bg-slate-900 rounded-xl border border-rose-500/30 shadow-2xl">
          <div className="font-medium mb-1">Render error</div>
          <div className="text-[11px] text-rose-300/70">{this.state.error}</div>
          <button
            onClick={() => { this.setState({ hasError: false, error: "" }); useUIStore.getState().selectRobot(null); }}
            className="mt-2 text-[11px] px-2.5 py-1 rounded-lg bg-slate-700/60 text-slate-300 hover:bg-slate-600/60 transition-colors"
          >
            Close
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const DETAIL_STATUS_PILL: Record<string, { bg: string; text: string }> = {
  active: { bg: "bg-emerald-500/15 border-emerald-500/30", text: "text-emerald-400" },
  idle: { bg: "bg-sky-500/15 border-sky-500/30", text: "text-sky-400" },
  returning: { bg: "bg-amber-500/15 border-amber-500/30", text: "text-amber-400" },
  error: { bg: "bg-rose-500/15 border-rose-500/30", text: "text-rose-400" },
  offline: { bg: "bg-slate-500/15 border-slate-500/30", text: "text-slate-400" },
};

function GaugeBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="w-full h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function DetailStat({ icon, label, value, unit }: { icon: string; label: string; value: string; unit?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
        <span className="text-[10px]">{icon}</span>
        {label}
      </span>
      <span className="text-[13px] text-slate-200">
        {value}
        {unit && <span className="text-[11px] text-slate-500 ml-1">{unit}</span>}
      </span>
    </div>
  );
}

function DetailContent() {
  const selectedId = useUIStore((s) => s.selectedRobotId);
  const selectRobot = useUIStore((s) => s.selectRobot);
  const robot = useRobotStore((s) => (selectedId ? s.robots[selectedId] : undefined));
  if (!robot) return null;

  const statusStyle = (DETAIL_STATUS_PILL[robot.status] ?? DETAIL_STATUS_PILL.offline)!;
  const battPercent = robot.health?.batteryPercent ?? 0;
  const battColor = battPercent > 50 ? "bg-emerald-500" : battPercent > 20 ? "bg-amber-500" : "bg-rose-500";

  return (
    <div className="absolute top-0 left-0 bottom-0 w-[340px] z-30 bg-slate-900 border-r border-slate-800 flex flex-col">
      <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-slate-700/40 flex-shrink-0">
        <div>
          <div className="text-sm font-semibold text-slate-100">{robot.name}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[11px] font-medium capitalize px-2 py-0.5 rounded-full border ${statusStyle.bg} ${statusStyle.text}`}>{robot.status}</span>
            <AutonomyBadge tier={(robot.autonomyTier ?? "assisted") as AutonomyTier} size="sm" />
            <span className="text-[11px] text-slate-500">{robot.id}</span>
          </div>
        </div>
        <button onClick={() => selectRobot(null)} className="text-slate-500 hover:text-slate-300 text-lg leading-none p-1 -mr-1 -mt-1 transition-colors">&times;</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 scrollbar-thin">
        <div className="space-y-2.5">
          <AutonomyTierSelector robotId={robot.id} currentTier={(robot.autonomyTier ?? "assisted") as AutonomyTier} />
          <AuthorityIndicator source={robot.lastCommandSource ?? ""} timestamp={robot.lastCommandAt ?? 0} />
        </div>

        <div>
          <div className="flex justify-between text-[11px] mb-1.5">
            <span className="text-slate-500 font-medium flex items-center gap-1.5"><span className="text-[10px]">{"\u26A1"}</span> Battery</span>
            <span className="text-slate-300">{battPercent.toFixed(0)}%</span>
          </div>
          <GaugeBar value={battPercent} max={100} color={battColor} />
        </div>

        <div>
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Position</div>
          <div className="space-y-0.5">
            <DetailStat icon={"\uD83C\uDF10"} label="Lat" value={(robot.position?.latitude ?? 0).toFixed(5)} />
            <DetailStat icon={"\uD83C\uDF10"} label="Lon" value={(robot.position?.longitude ?? 0).toFixed(5)} />
            <DetailStat icon={"\uD83E\uDDED"} label="Heading" value={(robot.position?.heading ?? 0).toFixed(0)} unit="deg" />
            <DetailStat icon={"\u23F1"} label="Speed" value={(robot.speed ?? 0).toFixed(1)} unit="m/s" />
          </div>
        </div>

        {robot.robotType === "drone" && (
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Drone</div>
            <div className="space-y-0.5">
              <DetailStat icon={"\u2708"} label="Altitude" value={(robot.position?.altitude ?? 0).toFixed(1)} unit="m" />
              <DetailStat icon={"\uD83D\uDCA8"} label="Air Speed" value={(robot.speed ?? 0).toFixed(1)} unit="m/s" />
            </div>
          </div>
        )}
        {robot.robotType === "ground" && (
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Rover</div>
            <div className="space-y-0.5">
              <DetailStat icon={"\u2699"} label="Ground Speed" value={(robot.speed ?? 0).toFixed(1)} unit="m/s" />
            </div>
          </div>
        )}
        {robot.robotType === "underwater" && (
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">UUV</div>
            <div className="space-y-0.5">
              <DetailStat icon={"\u2693"} label="Depth" value={Math.abs(robot.position?.altitude ?? 0).toFixed(1)} unit="m" />
              <DetailStat icon={"\uD83C\uDF0A"} label="Pressure" value={(Math.abs(robot.position?.altitude ?? 0) * 0.1).toFixed(2)} unit="atm" />
            </div>
          </div>
        )}

        <div className="border-t border-slate-700/40 pt-3">
          <CommandPalette robotId={robot.id} robotType={robot.robotType} />
        </div>
        <div className="border-t border-slate-700/40 pt-3">
          <CommandHistory robotId={robot.id} />
        </div>
      </div>
    </div>
  );
}

function DetailPopup() {
  return (
    <DetailErrorBoundary>
      <DetailContent />
    </DetailErrorBoundary>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   AI SUGGESTION / ALERTS PANEL
   ════════════════════════════════════════════════════════════════════════════ */

const SEVERITY_STYLES: Record<string, { border: string; icon: string }> = {
  critical: { border: "border-rose-500/40", icon: "!!!" },
  warning: { border: "border-amber-500/40", icon: "!" },
  info: { border: "border-sky-500/40", icon: "i" },
};

function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const [expanded, setExpanded] = useState(false);
  const approve = useAIStore((s) => s.approveSuggestion);
  const reject = useAIStore((s) => s.rejectSuggestion);
  const robot = useRobotStore((s) => s.robots[suggestion.robotId]);
  const countdown = useAutonomyStore((s) => s.countdowns[suggestion.id]);
  const style = (SEVERITY_STYLES[suggestion.severity] ?? SEVERITY_STYLES.info)!;
  const tier = (robot?.autonomyTier ?? "assisted") as AutonomyTier;

  const timeLeft = suggestion.expiresAt > 0 ? Math.max(0, Math.round(suggestion.expiresAt - Date.now() / 1000)) : null;

  const renderActions = () => {
    if (suggestion.status !== "pending") {
      return (
        <span className={clsx("text-[11px] capitalize", suggestion.status === "approved" ? "text-emerald-400" : "text-slate-500")}>
          {suggestion.status}
        </span>
      );
    }
    if (tier === "autonomous") {
      return (
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border bg-emerald-500/15 border-emerald-500/30 text-emerald-400">
          Auto-executed
        </span>
      );
    }
    if (tier === "supervised" && countdown) {
      return <CountdownTimer suggestionId={suggestion.id} autoExecuteAt={countdown.autoExecuteAt} />;
    }
    return (
      <>
        <button onClick={() => reject(suggestion.id)} className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-700/60 text-slate-400 hover:bg-slate-600/60 transition-colors">Dismiss</button>
        {tier !== "manual" && suggestion.proposedAction && (
          <button onClick={() => approve(suggestion.id)} className="text-[11px] px-2.5 py-1 rounded-lg bg-sky-600 text-white hover:bg-sky-500 transition-colors">Approve</button>
        )}
      </>
    );
  };

  return (
    <div className={clsx("rounded-xl border p-3.5 space-y-2.5 bg-slate-800/40", style.border)}>
      <div className="flex items-start gap-2.5">
        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-slate-700/50 text-slate-300">{style.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-slate-200 truncate">{suggestion.title}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{suggestion.description}</div>
        </div>
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          <span className="text-[11px] text-slate-500">{suggestion.source}</span>
          {suggestion.confidence > 0 && <span className="text-[11px] text-slate-500">{(suggestion.confidence * 100).toFixed(0)}%</span>}
        </div>
      </div>
      {expanded && (
        <div className="text-[13px] text-slate-400 bg-slate-800/50 rounded-lg p-2.5">{suggestion.reasoning}</div>
      )}
      <div className="flex items-center gap-2">
        <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
          {expanded ? "Less" : "More"}
        </button>
        <div className="flex-1" />
        {timeLeft !== null && !countdown && <span className="text-[11px] text-slate-600">{timeLeft}s</span>}
        {renderActions()}
      </div>
    </div>
  );
}

function FleetAlertStack({ suggestions }: { suggestions: Suggestion[] }) {
  const robots = useRobotStore((s) => s.robots);
  const robotList = Object.values(robots);
  const lowBattery = robotList.filter((r) => (r.health?.batteryPercent ?? 100) < 25);
  const lostComms = robotList.filter((r) => r.status === "offline");
  const criticalAlerts = suggestions.filter((s) => s.status === "pending" && s.severity === "critical");

  if (lowBattery.length === 0 && lostComms.length === 0 && criticalAlerts.length === 0) return null;

  return (
    <div className="mx-3 mb-2 space-y-1.5">
      {criticalAlerts.length > 0 && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-rose-500/10 border border-rose-500/25">
          <span className="text-rose-400 text-[11px] font-bold">!!!</span>
          <span className="text-[11px] text-rose-300">{criticalAlerts.length} critical alert{criticalAlerts.length > 1 ? "s" : ""}</span>
        </div>
      )}
      {lowBattery.length > 0 && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25">
          <span className="text-amber-400 text-[11px]">{"\u26A1"}</span>
          <span className="text-[11px] text-amber-300">{lowBattery.length} low battery: {lowBattery.map((r) => r.name).join(", ")}</span>
        </div>
      )}
      {lostComms.length > 0 && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-500/10 border border-slate-500/25">
          <span className="text-slate-400 text-[11px]">{"\uD83D\uDCE1"}</span>
          <span className="text-[11px] text-slate-300">{lostComms.length} lost comms: {lostComms.map((r) => r.name).join(", ")}</span>
        </div>
      )}
    </div>
  );
}

function AlertsPanel() {
  const suggestions = useAIStore((s) => s.suggestions);
  const isOpen = useUIStore((s) => s.alertsPanelOpen);
  const toggleAlertsPanel = useUIStore((s) => s.toggleAlertsPanel);

  const allSuggestions = Object.values(suggestions).sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    const sa = severityOrder[a.severity as keyof typeof severityOrder] ?? 2;
    const sb = severityOrder[b.severity as keyof typeof severityOrder] ?? 2;
    return sa - sb || b.createdAt - a.createdAt;
  });

  const pending = allSuggestions.filter((s) => s.status === "pending");
  if (!isOpen) return null;

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[340px] z-30 bg-slate-900 border-l border-slate-800 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-700/40">
        <div>
          <div className="text-sm font-semibold text-slate-200">Alerts</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{pending.length} pending</div>
        </div>
        <button onClick={toggleAlertsPanel} className="text-slate-500 hover:text-slate-300 text-lg leading-none p-1 transition-colors">&times;</button>
      </div>
      <div className="pt-3">
        <FleetAlertStack suggestions={allSuggestions} />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {allSuggestions.length === 0 ? (
          <div className="text-[13px] text-slate-500 text-center py-10">No alerts</div>
        ) : (
          allSuggestions.map((s) => <SuggestionCard key={s.id} suggestion={s} />)
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   SETTINGS PANEL
   ════════════════════════════════════════════════════════════════════════════ */

const SETTINGS_TIERS: { value: AutonomyTier; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "assisted", label: "Assisted" },
  { value: "supervised", label: "Supervised" },
  { value: "autonomous", label: "Autonomous" },
];

function SettingsPanel() {
  const isOpen = useUIStore((s) => s.settingsPanelOpen);
  const toggleSettings = useUIStore((s) => s.toggleSettingsPanel);
  const trailsEnabled = useUIStore((s) => s.trailsEnabled);
  const toggleTrails = useUIStore((s) => s.toggleTrails);
  const fleetDefaultTier = useAutonomyStore((s) => s.fleetDefaultTier);
  const setFleetDefault = useAutonomyStore((s) => s.setFleetDefault);

  if (!isOpen) return null;

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[300px] z-30 bg-slate-900 border-l border-slate-800 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-700/40">
        <div className="text-sm font-semibold text-slate-200">Settings</div>
        <button onClick={toggleSettings} className="text-slate-500 hover:text-slate-300 text-lg leading-none p-1 transition-colors">&times;</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 scrollbar-thin">
        <div>
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Map</div>
          <label className="flex items-center justify-between cursor-pointer group">
            <span className="text-[13px] text-slate-300">Robot Trails</span>
            <button
              onClick={toggleTrails}
              className={`w-9 h-5 rounded-full transition-colors duration-200 ${trailsEnabled ? "bg-sky-600" : "bg-slate-700"}`}
            >
              <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform duration-200 mx-0.5 ${trailsEnabled ? "translate-x-4" : "translate-x-0"}`} />
            </button>
          </label>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Autonomy</div>
          <div>
            <div className="text-[13px] text-slate-300 mb-2">Fleet Default Tier</div>
            <div className="grid grid-cols-2 gap-1.5">
              {SETTINGS_TIERS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setFleetDefault(t.value)}
                  className={`text-[11px] py-2 rounded-lg border transition-all duration-150 ${
                    fleetDefaultTier === t.value
                      ? "bg-sky-500/15 border-sky-500/40 text-sky-300"
                      : "border-slate-700/50 text-slate-500 hover:text-slate-300 hover:border-slate-600"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Display</div>
          <div className="space-y-2 text-[13px] text-slate-400">
            <div className="flex justify-between"><span>Theme</span><span className="text-slate-500">Dark</span></div>
            <div className="flex justify-between"><span>Map Style</span><span className="text-slate-500">CARTO Dark</span></div>
            <div className="flex justify-between"><span>Units</span><span className="text-slate-500">Metric</span></div>
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Keyboard Shortcuts</div>
          <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between"><span className="text-slate-400">Deselect robot</span><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">Esc</kbd></div>
            <div className="flex justify-between"><span className="text-slate-400">Next/Prev robot</span><div className="flex gap-1"><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">&darr;</kbd><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">&uarr;</kbd></div></div>
            <div className="flex justify-between"><span className="text-slate-400">Toggle trails</span><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">T</kbd></div>
            <div className="flex justify-between"><span className="text-slate-400">Toggle alerts</span><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">A</kbd></div>
            <div className="flex justify-between"><span className="text-slate-400">Settings</span><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">S</kbd></div>
          </div>
        </div>
        <div className="pt-3 border-t border-slate-700/40">
          <div className="text-[11px] text-slate-600 text-center">Argus Ground Station v1.0</div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   ALTITUDE INSET
   ════════════════════════════════════════════════════════════════════════════ */

const ALT_WIDTH = 200;
const ALT_HEIGHT = 150;
const SEA_LEVEL_Y = 100;
const ALT_SCALE = 1;

function clampY(altitude: number): number {
  const y = SEA_LEVEL_Y - altitude * ALT_SCALE;
  return Math.max(8, Math.min(ALT_HEIGHT - 8, y));
}

function AltitudeInset() {
  const selectedId = useUIStore((s) => s.selectedRobotId);
  const alertsOpen = useUIStore((s) => s.alertsPanelOpen);
  const robot = useRobotStore((s) => (selectedId ? s.robots[selectedId] : undefined));
  if (!robot) return null;

  const altitude = robot.position?.altitude ?? 0;
  const markerY = clampY(altitude);
  const isDrone = robot.robotType === "drone";
  const isUUV = robot.robotType === "underwater";
  const altitudeLabel = isUUV ? `${Math.abs(altitude).toFixed(1)}m depth` : `${altitude.toFixed(1)}m alt`;

  return (
    <div
      className="absolute bottom-5 z-20 bg-slate-900 border border-slate-700/60 rounded-xl p-3 shadow-2xl transition-all duration-300"
      style={{ right: alertsOpen ? 356 : 16 }}
    >
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
        {isDrone ? "Altitude" : isUUV ? "Depth" : "Elevation"}
      </div>
      <svg width={ALT_WIDTH} height={ALT_HEIGHT} className="block">
        <defs>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0c4a6e" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#0c4a6e" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0369a1" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#0369a1" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={ALT_WIDTH} height={SEA_LEVEL_Y} fill="url(#skyGrad)" />
        {isUUV && <rect x="0" y={SEA_LEVEL_Y} width={ALT_WIDTH} height={ALT_HEIGHT - SEA_LEVEL_Y} fill="url(#waterGrad)" />}
        <line x1="0" y1={SEA_LEVEL_Y} x2={ALT_WIDTH} y2={SEA_LEVEL_Y} stroke="#52525b" strokeWidth="1" strokeDasharray={isUUV ? "none" : "4 2"} />
        <text x="4" y={SEA_LEVEL_Y - 4} fill="#71717a" fontSize="9" fontFamily="Inter, system-ui">{isUUV ? "Sea Level" : "Ground"}</text>
        {[20, 40, 60].map((m) => {
          const y = SEA_LEVEL_Y - m * ALT_SCALE;
          if (y < 4 || y > ALT_HEIGHT - 4) return null;
          return (
            <g key={`above-${m}`}>
              <line x1="0" y1={y} x2={ALT_WIDTH} y2={y} stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="2 4" />
              <text x={ALT_WIDTH - 4} y={y - 2} fill="#52525b" fontSize="8" textAnchor="end" fontFamily="Inter, system-ui">{m}m</text>
            </g>
          );
        })}
        {isUUV && [-10, -20].map((m) => {
          const y = SEA_LEVEL_Y - m * ALT_SCALE;
          if (y < 4 || y > ALT_HEIGHT - 4) return null;
          return (
            <g key={`below-${m}`}>
              <line x1="0" y1={y} x2={ALT_WIDTH} y2={y} stroke="#0e7490" strokeWidth="0.5" strokeDasharray="2 4" />
              <text x={ALT_WIDTH - 4} y={y - 2} fill="#0e7490" fontSize="8" textAnchor="end" fontFamily="Inter, system-ui">{Math.abs(m)}m</text>
            </g>
          );
        })}
        {isDrone && altitude > 0 && (
          <line x1={ALT_WIDTH / 2} y1={markerY} x2={ALT_WIDTH / 2} y2={SEA_LEVEL_Y} stroke="#38bdf8" strokeWidth="1" strokeDasharray="3 2" opacity="0.5" />
        )}
        {isUUV && altitude < 0 && (
          <line x1={ALT_WIDTH / 2} y1={SEA_LEVEL_Y} x2={ALT_WIDTH / 2} y2={markerY} stroke="#0ea5e9" strokeWidth="1" strokeDasharray="3 2" opacity="0.5" />
        )}
        <circle cx={ALT_WIDTH / 2} cy={markerY} r="5" fill={isDrone ? "#38bdf8" : isUUV ? "#0ea5e9" : "#22c55e"} className="transition-all duration-500" />
        <circle cx={ALT_WIDTH / 2} cy={markerY} r="8" fill="none" stroke={isDrone ? "#38bdf8" : isUUV ? "#0ea5e9" : "#22c55e"} strokeWidth="1" opacity="0.3" className="transition-all duration-500" />
        <text x={ALT_WIDTH / 2 + 14} y={markerY + 4} fill="#e4e4e7" fontSize="10" fontWeight="600" fontFamily="Inter, system-ui" className="transition-all duration-500">{altitudeLabel}</text>
      </svg>
      <div className="text-[11px] text-slate-500 mt-1 text-center truncate">{robot.name}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   ROBOT MARKER
   ════════════════════════════════════════════════════════════════════════════ */

const MARKER_TIER_SHORT: Record<AutonomyTier, string> = { manual: "MAN", assisted: "AST", supervised: "SUP", autonomous: "AUT" };
const MARKER_TIER_COLOR: Record<AutonomyTier, string> = { manual: "#a1a1aa", assisted: "#38bdf8", supervised: "#fbbf24", autonomous: "#34d399" };
const MARKER_STATUS_COLORS: Record<string, string> = { active: "#22c55e", idle: "#3b82f6", returning: "#eab308", error: "#ef4444", offline: "#6b7280" };
const SELECTED_RING = "#38bdf8";

function robotSvg(type: RobotType, color: string, selected: boolean): string {
  const ring = selected ? `<circle cx="14" cy="14" r="13" fill="none" stroke="${SELECTED_RING}" stroke-width="2" opacity="0.8"/>` : "";
  const glow = selected ? `<circle cx="14" cy="14" r="10" fill="${SELECTED_RING}" opacity="0.15"/>` : "";
  switch (type) {
    case "drone":
      return `<svg width="28" height="28" viewBox="0 0 28 28" fill="none">${ring}${glow}<polygon points="14,3 23,23 14,18 5,23" fill="${color}" opacity="0.9"/></svg>`;
    case "ground":
      return `<svg width="28" height="28" viewBox="0 0 28 28" fill="none">${ring}${glow}<rect x="6" y="8" width="16" height="12" rx="3" fill="${color}" opacity="0.9"/><circle cx="9" cy="22" r="2.5" fill="${color}" opacity="0.7"/><circle cx="19" cy="22" r="2.5" fill="${color}" opacity="0.7"/></svg>`;
    case "underwater":
      return `<svg width="28" height="28" viewBox="0 0 28 28" fill="none">${ring}${glow}<ellipse cx="14" cy="14" rx="11" ry="6" fill="${color}" opacity="0.9"/><polygon points="25,14 28,10 28,18" fill="${color}" opacity="0.7"/><rect x="6" y="8" width="2" height="4" rx="1" fill="${color}" opacity="0.6"/></svg>`;
  }
}

function RobotMarker({ robot }: { robot: RobotState }) {
  const cumulativeRotation = useRef(robot.position.heading);
  const selectedId = useUIStore((s) => s.selectedRobotId);
  const isSelected = selectedId === robot.id;
  const color = MARKER_STATUS_COLORS[robot.status] || "#6b7280";

  const prevHeading = useRef(robot.position.heading);
  useMemo(() => {
    let delta = robot.position.heading - ((prevHeading.current % 360) + 360) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    cumulativeRotation.current += delta;
    prevHeading.current = robot.position.heading;
  }, [robot.position.heading]);

  const svgHtml = useMemo(() => robotSvg(robot.robotType, color, isSelected), [robot.robotType, color, isSelected]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const current = useUIStore.getState().selectedRobotId;
      useUIStore.getState().selectRobot(current === robot.id ? null : robot.id);
    },
    [robot.id],
  );

  const tier = (robot.autonomyTier ?? "assisted") as AutonomyTier;
  const tierLabel = MARKER_TIER_SHORT[tier];
  const tierColor = MARKER_TIER_COLOR[tier];

  return (
    <Marker longitude={robot.position.longitude} latitude={robot.position.latitude} anchor="center">
      <div className="robot-marker" onClick={handleClick} style={{ cursor: "pointer" }}>
        <div className="robot-marker-inner" style={{ transform: `rotate(${cumulativeRotation.current}deg)` }} dangerouslySetInnerHTML={{ __html: svgHtml }} />
        <div className="text-[8px] font-bold tracking-wider text-center mt-0.5 select-none" style={{ color: tierColor, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
          {tierLabel}
        </div>
      </div>
    </Marker>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   ROBOT TRAIL LAYER
   ════════════════════════════════════════════════════════════════════════════ */

const TRAIL_COLORS: Record<string, string> = { drone: "#22c55e", ground: "#a78bfa", underwater: "#38bdf8" };

function RobotTrailLayer() {
  const robots = useRobotStore((s) => s.robots);
  const trails = useRobotStore((s) => s.trails);
  const trailsEnabled = useUIStore((s) => s.trailsEnabled);

  const features = useMemo(() => {
    if (!trailsEnabled) return [];
    return Object.entries(trails)
      .filter(([, coords]) => coords.length >= 2)
      .map(([robotId, coords]) => {
        const robot = robots[robotId];
        const color = robot ? TRAIL_COLORS[robot.robotType] ?? "#94a3b8" : "#94a3b8";
        return {
          type: "Feature" as const,
          properties: { robotId, color },
          geometry: { type: "LineString" as const, coordinates: coords },
        };
      });
  }, [trails, robots, trailsEnabled]);

  const geojson = useMemo(() => ({ type: "FeatureCollection" as const, features }), [features]);

  const lineLayer: LayerProps = useMemo(
    () => ({
      id: "robot-trails",
      type: "line",
      paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.5 },
    }),
    [],
  );

  if (!trailsEnabled || features.length === 0) return null;

  return (
    <Source id="robot-trails-src" type="geojson" data={geojson}>
      <Layer {...lineLayer} />
    </Source>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   TRAJECTORY LAYER
   ════════════════════════════════════════════════════════════════════════════ */

function TrajectoryLayer({ waypoints, color }: { waypoints: Waypoint[]; color: string }) {
  if (!waypoints || waypoints.length === 0) return null;

  const lineGeoJSON = useMemo(
    () => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: waypoints.map((wp) => [wp.longitude, wp.latitude]) },
    }),
    [waypoints],
  );

  const lineLayer: LayerProps = useMemo(
    () => ({
      id: `trajectory-line-${waypoints[0]?.id ?? "default"}`,
      type: "line",
      paint: { "line-color": color, "line-width": 2, "line-opacity": 0.6, "line-dasharray": [4, 3] },
    }),
    [color, waypoints],
  );

  const sourceId = `trajectory-src-${waypoints[0]?.id ?? "default"}`;

  return (
    <>
      <Source id={sourceId} type="geojson" data={lineGeoJSON}>
        <Layer {...lineLayer} />
      </Source>
      {waypoints.map((wp) => {
        const isFilled = wp.status === "active" || wp.status === "completed";
        const opacity = wp.status === "skipped" ? 0.2 : wp.status === "pending" ? 0.5 : 0.9;
        return (
          <Marker key={wp.id} longitude={wp.longitude} latitude={wp.latitude} anchor="center">
            <div title={`WP ${wp.sequence + 1} (${wp.action}) — ${wp.status}`} style={{ opacity }}>
              <svg width="12" height="12" viewBox="0 0 12 12">
                <circle cx="6" cy="6" r="4" fill={isFilled ? color : "transparent"} stroke={color} strokeWidth="2" />
              </svg>
            </div>
          </Marker>
        );
      })}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MAP VIEW
   ════════════════════════════════════════════════════════════════════════════ */

/* ── Waypoint Overlay (pending waypoints during set_waypoints mode) ── */

function PendingWaypointOverlay() {
  const pendingWaypoints = useUIStore((s) => s.pendingWaypoints);

  const lineGeoJSON = useMemo(() => {
    if (pendingWaypoints.length < 2) return null;
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: pendingWaypoints.map((wp) => [wp.lng, wp.lat]),
      },
    };
  }, [pendingWaypoints]);

  const lineLayer: LayerProps = useMemo(
    () => ({
      id: "pending-waypoints-line",
      type: "line",
      paint: { "line-color": "#818cf8", "line-width": 2, "line-opacity": 0.7, "line-dasharray": [4, 3] },
    }),
    [],
  );

  if (pendingWaypoints.length === 0) return null;

  return (
    <>
      {lineGeoJSON && (
        <Source id="pending-wp-line-src" type="geojson" data={lineGeoJSON}>
          <Layer {...lineLayer} />
        </Source>
      )}
      {pendingWaypoints.map((wp, i) => (
        <Marker key={`pending-wp-${i}`} longitude={wp.lng} latitude={wp.lat} anchor="center">
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-500 border-2 border-white shadow-lg text-white text-[10px] font-bold">
            {i + 1}
          </div>
        </Marker>
      ))}
    </>
  );
}

/* ── Circle Overlay (during circle_area mode) ── */

function CircleOverlay() {
  const circleCenter = useUIStore((s) => s.circleCenter);
  const circleRadius = useUIStore((s) => s.circleRadius);

  const circleGeoJSON = useMemo(() => {
    if (!circleCenter) return null;
    const steps = 64;
    const coords: [number, number][] = [];
    const earthRadius = 6371000;
    const lat = (circleCenter.lat * Math.PI) / 180;
    const lng = (circleCenter.lng * Math.PI) / 180;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const dLat = (circleRadius / earthRadius) * Math.cos(angle);
      const dLng = (circleRadius / earthRadius) * Math.sin(angle) / Math.cos(lat);
      coords.push([(lng + dLng) * (180 / Math.PI), (lat + dLat) * (180 / Math.PI)]);
    }
    return {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Polygon" as const, coordinates: [coords] },
    };
  }, [circleCenter, circleRadius]);

  const fillLayer: LayerProps = useMemo(
    () => ({
      id: "circle-area-fill",
      type: "fill",
      paint: { "fill-color": "#ec4899", "fill-opacity": 0.1 },
    }),
    [],
  );
  const strokeLayer: LayerProps = useMemo(
    () => ({
      id: "circle-area-stroke",
      type: "line",
      paint: { "line-color": "#ec4899", "line-width": 2, "line-opacity": 0.6, "line-dasharray": [4, 3] },
    }),
    [],
  );

  if (!circleGeoJSON) return null;

  return (
    <>
      <Source id="circle-area-src" type="geojson" data={circleGeoJSON}>
        <Layer {...fillLayer} />
        <Layer {...strokeLayer} />
      </Source>
      <Marker longitude={circleCenter!.lng} latitude={circleCenter!.lat} anchor="center">
        <div className="w-3 h-3 rounded-full bg-pink-500 border-2 border-white shadow-lg" />
      </Marker>
    </>
  );
}

/* ── Floating Toolbar for Waypoint Mode ── */

function WaypointToolbar() {
  const commandMode = useUIStore((s) => s.commandMode);
  const pendingWaypoints = useUIStore((s) => s.pendingWaypoints);
  const undoWaypoint = useUIStore((s) => s.undoWaypoint);
  const clearWaypoints = useUIStore((s) => s.clearWaypoints);
  const setCommandMode = useUIStore((s) => s.setCommandMode);
  const selectedRobotId = useUIStore((s) => s.selectedRobotId);
  const sendCommand = useCommandStore((s) => s.sendCommand);

  if (commandMode !== "set_waypoints" || pendingWaypoints.length === 0) return null;

  const handleSend = () => {
    if (!selectedRobotId || pendingWaypoints.length === 0) return;
    const waypoints = pendingWaypoints.map((wp) => ({ latitude: wp.lat, longitude: wp.lng }));
    sendCommand(selectedRobotId, "follow_waypoints", { waypoints });
    clearWaypoints();
    setCommandMode("none");
  };

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2.5 bg-slate-900/95 border border-indigo-500/30 rounded-xl shadow-2xl">
      <MapPin className="w-4 h-4 text-indigo-400" />
      <span className="text-sm font-medium text-slate-200">{pendingWaypoints.length} waypoint{pendingWaypoints.length !== 1 ? "s" : ""}</span>
      <div className="w-px h-5 bg-slate-700" />
      <button onClick={undoWaypoint} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors">
        <Undo2 className="w-3.5 h-3.5" /> Undo
      </button>
      <button onClick={() => { clearWaypoints(); setCommandMode("none"); }} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors">
        <Trash2 className="w-3.5 h-3.5" /> Clear
      </button>
      <button onClick={handleSend} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-lg shadow-indigo-500/20">
        <Send className="w-3.5 h-3.5" /> Send
      </button>
    </div>
  );
}

/* ── Floating Toolbar for Circle Mode ── */

function CircleToolbar() {
  const commandMode = useUIStore((s) => s.commandMode);
  const circleCenter = useUIStore((s) => s.circleCenter);
  const circleRadius = useUIStore((s) => s.circleRadius);
  const setCircleRadius = useUIStore((s) => s.setCircleRadius);
  const setCircleCenter = useUIStore((s) => s.setCircleCenter);
  const setCommandMode = useUIStore((s) => s.setCommandMode);
  const selectedRobotId = useUIStore((s) => s.selectedRobotId);
  const sendCommand = useCommandStore((s) => s.sendCommand);

  if (commandMode !== "circle_area" || !circleCenter) return null;

  const handleConfirm = () => {
    if (!selectedRobotId) return;
    sendCommand(selectedRobotId, "circle_area", {
      latitude: circleCenter.lat,
      longitude: circleCenter.lng,
      radius: circleRadius,
    });
    setCircleCenter(null);
    setCommandMode("none");
  };

  const handleCancel = () => {
    setCircleCenter(null);
    setCommandMode("none");
  };

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2.5 bg-slate-900/95 border border-pink-500/30 rounded-xl shadow-2xl">
      <CircleDot className="w-4 h-4 text-pink-400" />
      <span className="text-sm font-medium text-slate-200">Radius</span>
      <input
        type="range" min={50} max={500} step={10} value={circleRadius}
        onChange={(e) => setCircleRadius(Number(e.target.value))}
        className="w-28 accent-pink-500"
      />
      <span className="text-xs font-mono text-slate-400 w-12">{circleRadius}m</span>
      <div className="w-px h-5 bg-slate-700" />
      <button onClick={handleCancel} className="px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors">
        Cancel
      </button>
      <button onClick={handleConfirm} className="px-3 py-1.5 text-xs font-medium text-white bg-pink-600 hover:bg-pink-500 rounded-lg transition-colors shadow-lg shadow-pink-500/20">
        Confirm
      </button>
    </div>
  );
}

/* ── Set Home Hint ── */

function SetHomeHint() {
  const commandMode = useUIStore((s) => s.commandMode);
  const setCommandMode = useUIStore((s) => s.setCommandMode);
  if (commandMode !== "set_home") return null;
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2.5 bg-slate-900/95 border border-amber-500/30 rounded-xl shadow-2xl">
      <Home className="w-4 h-4 text-amber-400" />
      <span className="text-sm font-medium text-slate-200">Click map to set new home position</span>
      <button onClick={() => setCommandMode("none")} className="px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors">
        Cancel
      </button>
    </div>
  );
}

function MapView() {
  const mapRef = useRef<MapRef>(null);
  const robots = useRobotStore((s) => s.robots);
  const robotList = Object.values(robots);
  const commandMode = useUIStore((s) => s.commandMode);
  const setCommandMode = useUIStore((s) => s.setCommandMode);
  const sendCommand = useCommandStore((s) => s.sendCommand);
  const addWaypoint = useUIStore((s) => s.addWaypoint);
  const setCircleCenter = useUIStore((s) => s.setCircleCenter);
  const missions = useMissionStore((s) => s.missions);
  const activeMission = Object.values(missions).find((m) => m.status === "active");
  const hasFitted = useRef(false);

  // Auto-fit map to show all robots once they load
  useEffect(() => {
    if (hasFitted.current || robotList.length === 0) return;
    const map = mapRef.current;
    if (!map) return;
    hasFitted.current = true;

    const lngs = robotList.map((r) => r.position.longitude);
    const lats = robotList.map((r) => r.position.latitude);
    const sw: [number, number] = [Math.min(...lngs) - 0.005, Math.min(...lats) - 0.005];
    const ne: [number, number] = [Math.max(...lngs) + 0.005, Math.max(...lats) + 0.005];
    map.fitBounds([sw, ne], { padding: 60, maxZoom: 16, duration: 800 });
  }, [robotList]);

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const { commandMode: cm, selectedRobotId } = useUIStore.getState();
      if (!selectedRobotId) return;
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;

      switch (cm) {
        case "goto":
          sendCommand(selectedRobotId, "goto", { latitude: lat, longitude: lng });
          setCommandMode("none");
          break;
        case "set_home":
          sendCommand(selectedRobotId, "set_home", { latitude: lat, longitude: lng });
          setCommandMode("none");
          break;
        case "set_waypoints":
          addWaypoint(lat, lng);
          break;
        case "circle_area":
          if (!useUIStore.getState().circleCenter) {
            setCircleCenter({ lat, lng });
          }
          break;
      }
    },
    [sendCommand, setCommandMode, addWaypoint, setCircleCenter],
  );

  const cursorMode = commandMode !== "none" ? "cursor-crosshair" : undefined;

  return (
    <div className={cursorMode} style={{ position: "absolute", inset: 0 }}>
      <Map
        ref={mapRef}
        initialViewState={{ ...DEFAULT_CENTER, zoom: DEFAULT_ZOOM }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={DARK_STYLE}
        onClick={handleClick}
        attributionControl={true}
      >
        <NavigationControl position="bottom-right" />
        <RobotTrailLayer />
        <PendingWaypointOverlay />
        <CircleOverlay />
        {activeMission &&
          Object.entries(activeMission.waypoints).map(([robotId, waypoints]) => {
            const robot = robots[robotId];
            return <TrajectoryLayer key={robotId} waypoints={waypoints} color={robot ? ROBOT_COLORS[robot.robotType] || "#94a3b8" : "#94a3b8"} />;
          })}
        {robotList.map((robot) => (
          <RobotMarker key={robot.id} robot={robot} />
        ))}
      </Map>
      <WaypointToolbar />
      <CircleToolbar />
      <SetHomeHint />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   HEADER BAR
   ════════════════════════════════════════════════════════════════════════════ */

function HeaderBar() {
  const robots = useRobotStore((s) => s.robots);
  const pendingSuggestions = useAIStore((s) => Object.values(s.suggestions).filter((sg) => sg.status === "pending").length);
  const alertsPanelOpen = useUIStore((s) => s.alertsPanelOpen);
  const toggleAlertsPanel = useUIStore((s) => s.toggleAlertsPanel);
  const settingsPanelOpen = useUIStore((s) => s.settingsPanelOpen);
  const toggleSettingsPanel = useUIStore((s) => s.toggleSettingsPanel);
  const fleetDefaultTier = useAutonomyStore((s) => s.fleetDefaultTier);

  const robotList = Object.values(robots);
  const activeCount = robotList.filter((r) => r.status === "active").length;
  const totalCount = robotList.length;

  // Voice activity: true if any robot received a voice command in the last 30s
  const voiceActive = robotList.some(
    (r) => r.lastCommandSource === "voice" && Date.now() / 1000 - r.lastCommandAt < 30,
  );

  return (
    <div className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-8 shrink-0">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Radio className="w-4 h-4 text-slate-500" />
            <span className="font-medium text-slate-300">{activeCount}</span>
            <span className="text-slate-500">active</span>
          </div>
          <div className="w-px h-4 bg-slate-700" />
          <div className="text-sm">
            <span className="font-medium text-slate-300">{totalCount}</span>
            <span className="text-slate-500"> total units</span>
          </div>
        </div>
        <div className="w-px h-4 bg-slate-700" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Fleet:</span>
          <AutonomyBadge tier={fleetDefaultTier} size="md" />
        </div>
        {voiceActive && (
          <>
            <div className="w-px h-4 bg-slate-700" />
            <div className="flex items-center gap-1.5 text-amber-400">
              <div className="relative">
                <Phone className="w-3.5 h-3.5" />
                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
              </div>
              <span className="text-xs font-medium">Voice Active</span>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={toggleAlertsPanel}
          className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 border ${
            alertsPanelOpen
              ? "bg-amber-500/20 text-amber-300 border-amber-500/30 shadow-lg shadow-amber-500/10"
              : pendingSuggestions > 0
                ? "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/15 hover:border-amber-500/30"
                : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:border-slate-600"
          }`}
        >
          <AlertCircle className="w-4 h-4" />
          {pendingSuggestions > 0 ? `${pendingSuggestions} Alert${pendingSuggestions > 1 ? "s" : ""}` : "Alerts"}
        </button>
        <button className="p-2.5 hover:bg-slate-800 rounded-lg transition-all duration-200 relative group">
          <Bell className="w-5 h-5 text-slate-400 group-hover:text-slate-300 transition-colors" />
          {pendingSuggestions > 0 && <div className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
        </button>
        <button
          onClick={toggleSettingsPanel}
          className={`p-2.5 rounded-lg transition-all duration-200 group ${
            settingsPanelOpen ? "bg-slate-700 text-slate-200" : "hover:bg-slate-800 text-slate-400 hover:text-slate-300"
          }`}
        >
          <Settings className="w-5 h-5 transition-transform group-hover:rotate-45 duration-300" />
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   ROBOT LIST PANEL (Sidebar)
   ════════════════════════════════════════════════════════════════════════════ */

const STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]",
  idle: "bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.5)]",
  returning: "bg-amber-500 shadow-[0_0_6px_rgba(234,179,8,0.5)] animate-pulse",
  error: "bg-rose-500 shadow-[0_0_6px_rgba(239,68,68,0.6)] animate-pulse",
  offline: "bg-slate-600",
};

const TYPE_LABELS: Record<string, string> = { drone: "Drone", ground: "Rover", underwater: "UUV" };
const STATUS_ORDER: Record<string, number> = { error: 0, active: 1, returning: 2, idle: 3, offline: 4 };

function RobotRow({ robot }: { robot: RobotState }) {
  const selectRobot = useUIStore((s) => s.selectRobot);
  const selectedId = useUIStore((s) => s.selectedRobotId);
  const isSelected = selectedId === robot.id;
  const battPercent = robot.health?.batteryPercent ?? 0;
  const battColor = battPercent > 50 ? "bg-emerald-500" : battPercent > 20 ? "bg-amber-500" : "bg-rose-500";

  return (
    <button
      onClick={() => selectRobot(isSelected ? null : robot.id)}
      className={clsx(
        "w-full text-left rounded-xl p-4 transition-all duration-200",
        isSelected
          ? "bg-blue-500/10 border border-blue-500/30 shadow-lg shadow-blue-500/5"
          : "hover:bg-slate-800/60 border border-transparent hover:border-slate-700/50",
      )}
    >
      <div className="flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${STATUS_DOT[robot.status] || "bg-slate-600"}`} />
        <div className="flex-1 min-w-0">
          <div className="text-base font-medium text-slate-200 truncate">{robot.name}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-slate-500">{TYPE_LABELS[robot.robotType] || robot.robotType}</span>
            <AutonomyBadge tier={(robot.autonomyTier ?? "assisted") as AutonomyTier} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className="text-sm font-medium text-slate-300">{battPercent.toFixed(0)}%</span>
          <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${battColor} transition-all duration-500`} style={{ width: `${battPercent}%` }} />
          </div>
        </div>
      </div>
    </button>
  );
}

type Tab = "units" | "analytics" | "missions";

function RobotListPanel({ onMissionPlan }: { onMissionPlan?: () => void }) {
  const robots = useRobotStore((s) => s.robots);
  const connected = useConnectionStore((s) => s.connected);
  const reconnecting = useConnectionStore((s) => s.reconnecting);
  const fleetDefaultTier = useAutonomyStore((s) => s.fleetDefaultTier);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const sortBy = useUIStore((s) => s.sortBy);
  const setSortBy = useUIStore((s) => s.setSortBy);
  const filterStatus = useUIStore((s) => s.filterStatus);
  const setFilterStatus = useUIStore((s) => s.setFilterStatus);

  const [tab, setTab] = useState<Tab>("units");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const robotList = Object.values(robots);
  const tierLabel = fleetDefaultTier.slice(0, 3).toUpperCase();

  const filtered = useMemo(() => {
    let list = robotList;
    if (filterStatus !== "all") list = list.filter((r) => r.status === filterStatus);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || r.robotType.toLowerCase().includes(q));
    }
    return list;
  }, [robotList, filterStatus, searchQuery]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    switch (sortBy) {
      case "name": list.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "status": list.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)); break;
      case "battery": list.sort((a, b) => (a.health?.batteryPercent ?? 0) - (b.health?.batteryPercent ?? 0)); break;
      case "type": list.sort((a, b) => a.robotType.localeCompare(b.robotType)); break;
    }
    return list;
  }, [filtered, sortBy]);

  const filterLabel: Record<string, string> = { all: "All Status", active: "Active", idle: "Idle", returning: "Returning", error: "Error", offline: "Offline" };
  const sortLabel: Record<string, string> = { name: "Sort: Name", status: "Sort: Status", battery: "Sort: Battery", type: "Sort: Type" };

  return (
    <div className="w-80 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
      <div className="px-6 pt-6 pb-6 border-b border-slate-800">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Fleet Command</h1>
            <p className="text-sm text-slate-400 mt-1.5">{tierLabel} Operations</p>
          </div>
          <button className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
            <Menu className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div className={clsx(
          "flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-200",
          connected ? "bg-emerald-500/10 border-emerald-500/20" : reconnecting ? "bg-amber-500/10 border-amber-500/20" : "bg-rose-500/10 border-rose-500/20",
        )}>
          <div className={clsx("w-2 h-2 rounded-full transition-colors", connected ? "bg-emerald-500 animate-pulse" : reconnecting ? "bg-amber-500 animate-pulse" : "bg-rose-500")} />
          <span className={clsx("text-sm font-medium", connected ? "text-emerald-400" : reconnecting ? "text-amber-400" : "text-rose-400")}>
            {connected ? "System Connected" : reconnecting ? "Reconnecting..." : "Offline"}
          </span>
        </div>
      </div>

      <div className="flex border-b border-slate-800 px-6 gap-2 mt-2">
        {(["units", "analytics", "missions"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "px-4 py-3 text-sm font-medium transition-colors relative rounded-t-lg",
              tab === t ? "text-blue-400 bg-slate-800/50" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/30",
            )}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {tab === t && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />}
          </button>
        ))}
      </div>

      {tab === "units" ? (
        <>
          <div className="px-6 py-6 border-b border-slate-800 space-y-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none z-10" />
              <input
                type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search units..."
                className="w-full pl-11 pr-10 py-3 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-lg font-light">×</button>
              )}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <button
                  onClick={() => { setFilterOpen(!filterOpen); setSortOpen(false); }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-750 hover:border-slate-600 transition-all"
                >
                  <div className="flex items-center gap-2"><Filter className="w-3.5 h-3.5" /><span>{filterLabel[filterStatus] || "All Status"}</span></div>
                  <ChevronDown className="w-3 h-3" />
                </button>
                {filterOpen && (
                  <div className="absolute top-full left-0 mt-2 w-full bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 py-1 animate-in fade-in duration-100">
                    {(["all", "active", "idle", "returning", "error", "offline"] as const).map((s) => (
                      <button key={s} onClick={() => { setFilterStatus(s as RobotStatus | "all"); setFilterOpen(false); }} className={clsx("w-full text-left px-3 py-2 text-xs transition-colors", filterStatus === s ? "text-blue-400 bg-blue-500/10" : "text-slate-300 hover:bg-slate-700")}>
                        {filterLabel[s]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative flex-1">
                <button
                  onClick={() => { setSortOpen(!sortOpen); setFilterOpen(false); }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-750 hover:border-slate-600 transition-all"
                >
                  <span>{sortLabel[sortBy] || "Sort: Name"}</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
                {sortOpen && (
                  <div className="absolute top-full left-0 mt-2 w-full bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 py-1 animate-in fade-in duration-100">
                    {(["name", "status", "battery", "type"] as const).map((s) => (
                      <button key={s} onClick={() => { setSortBy(s); setSortOpen(false); }} className={clsx("w-full text-left px-3 py-2 text-xs transition-colors", sortBy === s ? "text-blue-400 bg-blue-500/10" : "text-slate-300 hover:bg-slate-700")}>
                        {sortLabel[s]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-thin">
            {sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 rounded-2xl flex items-center justify-center mb-5 border border-blue-500/20">
                  <Plane className="w-10 h-10 text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{robotList.length === 0 ? "No Units Connected" : "No Matches"}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  {robotList.length === 0 ? "Waiting for fleet telemetry. Units will appear here once they establish connection." : "Try adjusting your search or filters."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {sorted.map((robot) => <RobotRow key={robot.id} robot={robot} />)}
              </div>
            )}
          </div>
        </>
      ) : tab === "analytics" ? (
        <div className="flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
          <FleetStatsPanel />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-thin">
          <div className="text-sm text-slate-500 text-center py-10 leading-relaxed">Use the "Update Mission" button below to create or modify missions.</div>
        </div>
      )}

      {onMissionPlan && (
        <div className="px-6 py-5 border-t border-slate-800 mt-auto">
          <button
            onClick={onMissionPlan}
            className="w-full px-5 py-4 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl font-semibold text-base hover:from-violet-700 hover:to-indigo-700 transition-all shadow-lg shadow-violet-500/25 flex items-center justify-center gap-2.5"
          >
            <Sparkles className="w-5 h-5" />
            Update Mission
          </button>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MISSION PLAN DIALOG
   ════════════════════════════════════════════════════════════════════════════ */

type DialogMode = "quick" | "plan";

function MissionPlanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const robots = useRobotStore((s) => s.robots);
  const generatePlan = useAIStore((s) => s.generatePlan);
  const planLoading = useAIStore((s) => s.planLoading);
  const executeAI = useAIStore((s) => s.executeAI);
  const executeLoading = useAIStore((s) => s.executeLoading);

  const [mode, setMode] = useState<DialogMode>("quick");
  const [objective, setObjective] = useState("");
  const [constraintInput, setConstraintInput] = useState("");
  const [constraints, setConstraints] = useState<string[]>([]);
  const [roeInput, setRoeInput] = useState("");
  const [roe, setRoe] = useState<string[]>([]);
  const [selectedRobots, setSelectedRobots] = useState<string[]>([]);
  const [executionResult, setExecutionResult] = useState<string | null>(null);

  if (!open) return null;

  const robotList = Object.values(robots).filter((r) => r.status !== "offline");
  const addConstraint = () => { if (constraintInput.trim()) { setConstraints((c) => [...c, constraintInput.trim()]); setConstraintInput(""); } };
  const addRoe = () => { if (roeInput.trim()) { setRoe((r) => [...r, roeInput.trim()]); setRoeInput(""); } };
  const toggleRobot = (id: string) => { setSelectedRobots((sel) => sel.includes(id) ? sel.filter((r) => r !== id) : [...sel, id]); };

  const handlePlanSubmit = async () => {
    const intent: MissionIntent = { objective, constraints, rulesOfEngagement: roe, preferences: {}, selectedRobots: selectedRobots.length > 0 ? selectedRobots : undefined };
    await generatePlan(intent);
  };

  const handleQuickExecute = async () => {
    setExecutionResult(null);
    const result = await executeAI(objective, selectedRobots.length > 0 ? selectedRobots : undefined);
    if (result.error) {
      setExecutionResult(`Error: ${result.error}`);
    } else {
      setExecutionResult(result.explanation || "Commands dispatched.");
      setTimeout(() => onClose(), 2500);
    }
  };

  const isLoading = mode === "quick" ? executeLoading : planLoading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between px-8 pt-8 pb-6 border-b border-slate-800">
          <div>
            <h2 className="text-2xl font-semibold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-500/30 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-violet-400" />
              </div>
              Update Mission
            </h2>
            <p className="text-sm text-slate-400 mt-2 ml-[52px]">Describe what you need and AI will handle it</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        {/* Mode Toggle */}
        <div className="px-8 pt-4 flex gap-2">
          <button
            onClick={() => setMode("quick")}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border transition-all ${
              mode === "quick"
                ? "bg-violet-500/15 border-violet-500/40 text-violet-300"
                : "border-slate-700 text-slate-400 hover:text-slate-300 hover:border-slate-600"
            }`}
          >
            Quick Execute
          </button>
          <button
            onClick={() => setMode("plan")}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border transition-all ${
              mode === "plan"
                ? "bg-violet-500/15 border-violet-500/40 text-violet-300"
                : "border-slate-700 text-slate-400 hover:text-slate-300 hover:border-slate-600"
            }`}
          >
            Plan & Review
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 scrollbar-thin">
          <div>
            <label className="block text-sm font-medium text-slate-200 mb-3">
              {mode === "quick" ? "Instruction" : "Objective"} <span className="text-rose-400">*</span>
            </label>
            <textarea value={objective} onChange={(e) => setObjective(e.target.value)}
              placeholder={mode === "quick" ? "e.g. Set up a perimeter around Lake Elizabeth..." : "Describe the mission objective in detail..."}
              className="w-full px-4 py-3.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none transition-all leading-relaxed"
              rows={mode === "quick" ? 3 : 4} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-200 mb-3">Robots <span className="text-xs text-slate-500 font-normal">({selectedRobots.length || "all"} selected)</span></label>
            <div className="flex flex-wrap gap-2">
              {robotList.map((r) => (
                <button key={r.id} onClick={() => toggleRobot(r.id)}
                  className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${selectedRobots.includes(r.id) ? "border-blue-500/40 bg-blue-500/10 text-blue-300 shadow-lg shadow-blue-500/5" : "border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600 hover:bg-slate-800"}`}>
                  {r.name}
                </button>
              ))}
            </div>
          </div>

          {/* Plan mode extras */}
          {mode === "plan" && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-3">Constraints</label>
                <div className="flex gap-2 mb-3">
                  <input value={constraintInput} onChange={(e) => setConstraintInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addConstraint()} placeholder="Add a constraint..."
                    className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" />
                  <button onClick={addConstraint} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"><Plus className="w-4 h-4" />Add</button>
                </div>
                {constraints.length > 0 && (
                  <div className="space-y-2">
                    {constraints.map((c, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg group hover:bg-slate-800 transition-colors">
                        <span className="flex-1 text-sm text-slate-300">{c}</span>
                        <button onClick={() => setConstraints((cs) => cs.filter((_, j) => j !== i))} className="p-1.5 hover:bg-slate-700 rounded-md transition-colors text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-3">Rules of Engagement</label>
                <div className="flex gap-2 mb-3">
                  <input value={roeInput} onChange={(e) => setRoeInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRoe()} placeholder="Add a rule..."
                    className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" />
                  <button onClick={addRoe} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"><Plus className="w-4 h-4" />Add</button>
                </div>
                {roe.length > 0 && (
                  <div className="space-y-2">
                    {roe.map((r, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg group hover:bg-slate-800 transition-colors">
                        <span className="flex-1 text-sm text-slate-300">{r}</span>
                        <button onClick={() => setRoe((rs) => rs.filter((_, j) => j !== i))} className="p-1.5 hover:bg-slate-700 rounded-md transition-colors text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Execution result toast */}
          {executionResult && (
            <div className={`flex items-start gap-3 px-4 py-4 rounded-xl border ${
              executionResult.startsWith("Error")
                ? "bg-rose-500/10 border-rose-500/30"
                : "bg-emerald-500/10 border-emerald-500/30"
            }`}>
              {executionResult.startsWith("Error")
                ? <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                : <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              }
              <div className="text-sm text-slate-200">{executionResult}</div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-8 py-6 border-t border-slate-800">
          <button onClick={onClose} className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors text-sm font-medium">Cancel</button>
          {mode === "quick" ? (
            <button onClick={handleQuickExecute} disabled={!objective.trim() || isLoading}
              className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${objective.trim() && !isLoading ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" : "bg-slate-700 text-slate-500 cursor-not-allowed"}`}>
              <Send className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
              {isLoading ? "Executing..." : "Execute"}
            </button>
          ) : (
            <button onClick={handlePlanSubmit} disabled={!objective.trim() || isLoading}
              className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${objective.trim() && !isLoading ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" : "bg-slate-700 text-slate-500 cursor-not-allowed"}`}>
              <Sparkles className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
              {isLoading ? "Generating Plan..." : "Generate Plan"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MISSION PLAN REVIEW
   ════════════════════════════════════════════════════════════════════════════ */

function MissionPlanReview({ onClose }: { onClose: () => void }) {
  const plan = useAIStore((s) => s.pendingPlan);
  const planError = useAIStore((s) => s.planError);
  const approvePlan = useAIStore((s) => s.approvePlan);
  const clearPlan = useAIStore((s) => s.clearPlan);

  if (!plan && !planError) return null;

  const handleApprove = async () => { await approvePlan(); onClose(); };
  const handleReject = () => { clearPlan(); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleReject} />
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between px-8 pt-8 pb-6 border-b border-slate-800">
          <div>
            <h2 className="text-2xl font-semibold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              Mission Plan Review
            </h2>
            <p className="text-sm text-slate-400 mt-2 ml-[52px]">Review and approve the AI-generated mission plan</p>
          </div>
          <button onClick={handleReject} className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 scrollbar-thin">
          {planError && (
            <div className="flex items-start gap-3 px-4 py-4 bg-rose-500/10 border border-rose-500/30 rounded-xl">
              <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium text-rose-300 mb-1">Plan Generation Failed</div>
                <div className="text-sm text-rose-400/80">{planError}</div>
              </div>
            </div>
          )}
          {plan && (
            <>
              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-100">{plan.name}</h3>
                  <div className="flex items-center gap-4 mt-2 text-sm text-slate-400">
                    <span>Estimated Duration: {plan.estimatedDurationMinutes} minutes</span>
                    <span>•</span>
                    <span>{plan.assignments.length} robot{plan.assignments.length !== 1 ? "s" : ""} assigned</span>
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Robot Assignments</h4>
                <div className="space-y-3">
                  {plan.assignments.map((a, i) => (
                    <div key={i} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 hover:bg-slate-800 transition-colors">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-base font-medium text-slate-100">{a.robotId}</span>
                        <span className="px-3 py-1 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/25 text-xs font-medium uppercase tracking-wide">{a.role}</span>
                      </div>
                      <p className="text-sm text-slate-400 leading-relaxed mb-3">{a.rationale}</p>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                        {a.waypoints.length} waypoint{a.waypoints.length !== 1 ? "s" : ""} planned
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {plan.contingencies.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Contingency Plans</h4>
                  <div className="space-y-3">
                    {plan.contingencies.map((c, i) => (
                      <div key={i} className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-5">
                        <div className="space-y-2 text-sm">
                          <div className="flex items-start gap-2"><span className="font-semibold text-amber-400 shrink-0">If:</span><span className="text-slate-300">{c.trigger}</span></div>
                          <div className="flex items-start gap-2"><span className="font-semibold text-blue-400 shrink-0">Then:</span><span className="text-slate-300">{c.action}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-8 py-6 border-t border-slate-800">
          <button onClick={handleReject} className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors text-sm font-medium">Reject Plan</button>
          {plan && (
            <button onClick={handleApprove} className="px-6 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/20">
              <CheckCircle2 className="w-4 h-4" />
              Approve & Deploy
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   APP (root)
   ════════════════════════════════════════════════════════════════════════════ */

export default function App() {
  useWebSocket();
  useKeyboardShortcuts();

  const [missionDialogOpen, setMissionDialogOpen] = useState(false);
  const pendingPlan = useAIStore((s) => s.pendingPlan);
  const planError = useAIStore((s) => s.planError);

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden">
      <RobotListPanel onMissionPlan={() => setMissionDialogOpen(true)} />
      <div className="flex-1 flex flex-col min-w-0">
        <HeaderBar />
        <div className="flex-1 relative">
          <MapView />
          <DetailPopup />
          <AlertsPanel />
          <SettingsPanel />
          <AltitudeInset />
        </div>
      </div>
      <MissionPlanDialog open={missionDialogOpen} onClose={() => setMissionDialogOpen(false)} />
      {(pendingPlan || planError) && (
        <MissionPlanReview onClose={() => useAIStore.getState().clearPlan()} />
      )}
    </div>
  );
}
