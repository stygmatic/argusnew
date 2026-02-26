// ===========================================================================
// lib.ts — All types, Zustand stores, and hooks merged into one file
// ===========================================================================

import { create } from "zustand";
import { useState, useEffect, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types — robot
// ---------------------------------------------------------------------------

export type RobotType = "drone" | "ground" | "underwater";
export type RobotStatus = "idle" | "active" | "returning" | "error" | "offline";
export type AutonomyTier = "manual" | "assisted" | "supervised" | "autonomous";

export interface RobotPosition {
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
}

export interface RobotHealth {
  batteryPercent: number;
  signalStrength: number;
}

export interface RobotState {
  id: string;
  name: string;
  robotType: RobotType;
  status: RobotStatus;
  position: RobotPosition;
  speed: number;
  health: RobotHealth;
  lastSeen: number;
  metadata: Record<string, unknown>;
  autonomyTier: AutonomyTier;
  lastCommandSource: string;
  lastCommandAt: number;
}

// ---------------------------------------------------------------------------
// Types — command
// ---------------------------------------------------------------------------

export type CommandType = "goto" | "stop" | "return_home" | "patrol" | "set_speed";
export type CommandSource = "operator" | "ai";
export type CommandStatus = "pending" | "sent" | "acknowledged" | "completed" | "failed";

export interface Command {
  id: string;
  robotId: string;
  commandType: CommandType;
  parameters: Record<string, unknown>;
  source: CommandSource;
  status: CommandStatus;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Types — mission
// ---------------------------------------------------------------------------

export type MissionStatus = "draft" | "active" | "paused" | "completed" | "aborted";
export type WaypointStatus = "pending" | "active" | "completed" | "skipped";

export interface Waypoint {
  id: string;
  sequence: number;
  latitude: number;
  longitude: number;
  altitude: number;
  action: string;
  parameters: Record<string, unknown>;
  status: WaypointStatus;
}

export interface Mission {
  id: string;
  name: string;
  status: MissionStatus;
  assignedRobots: string[];
  waypoints: Record<string, Waypoint[]>;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Types — AI
// ---------------------------------------------------------------------------

export type SuggestionSeverity = "info" | "warning" | "critical";
export type SuggestionStatus = "pending" | "approved" | "rejected" | "expired";
export type SuggestionSource = "heuristic" | "ai";

export interface ProposedAction {
  commandType: string;
  robotId: string;
  parameters?: Record<string, unknown>;
}

export interface Suggestion {
  id: string;
  robotId: string;
  title: string;
  description: string;
  reasoning: string;
  severity: SuggestionSeverity;
  proposedAction: ProposedAction | null;
  confidence: number;
  status: SuggestionStatus;
  source: SuggestionSource;
  createdAt: number;
  expiresAt: number;
}

export interface MissionPlan {
  name: string;
  estimatedDurationMinutes: number;
  assignments: MissionAssignment[];
  contingencies: Contingency[];
}

export interface MissionAssignment {
  robotId: string;
  role: string;
  rationale: string;
  waypoints: PlanWaypoint[];
}

export interface PlanWaypoint {
  latitude: number;
  longitude: number;
  altitude: number;
  action: string;
}

export interface Contingency {
  trigger: string;
  action: string;
}

export interface MissionIntent {
  objective: string;
  zone?: Record<string, unknown> | null;
  constraints: string[];
  rulesOfEngagement: string[];
  preferences: Record<string, unknown>;
  selectedRobots?: string[];
}

// ---------------------------------------------------------------------------
// Types — WebSocket messages
// ---------------------------------------------------------------------------

export interface WSMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}

export interface StateSyncPayload {
  robots: Record<string, RobotState>;
  missions?: Record<string, Mission>;
}

export interface RobotUpdatedPayload extends RobotState {}

// ---------------------------------------------------------------------------
// Types — autonomy
// ---------------------------------------------------------------------------

export interface AutonomyChangeEntry {
  id: string;
  robotId: string;
  oldTier: AutonomyTier;
  newTier: AutonomyTier;
  changedBy: string;
  timestamp: number;
}

export interface CountdownSuggestion {
  suggestionId: string;
  robotId: string;
  commandType: string;
  autoExecuteAt: number;
}

// ===========================================================================
// Stores
// ===========================================================================

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ---------------------------------------------------------------------------
// useConnectionStore
// ---------------------------------------------------------------------------

interface ConnectionStore {
  connected: boolean;
  reconnecting: boolean;
  setConnected: (connected: boolean) => void;
  setReconnecting: (reconnecting: boolean) => void;
}

export const useConnectionStore = create<ConnectionStore>()((set) => ({
  connected: false,
  reconnecting: false,
  setConnected: (connected) => set({ connected }),
  setReconnecting: (reconnecting) => set({ reconnecting }),
}));

// ---------------------------------------------------------------------------
// useRobotStore
// ---------------------------------------------------------------------------

const MAX_TRAIL_POINTS = 60;

interface RobotStore {
  robots: Record<string, RobotState>;
  trails: Record<string, [number, number][]>;
  setRobots: (robots: Record<string, RobotState>) => void;
  updateRobot: (id: string, robot: RobotState) => void;
}

export const useRobotStore = create<RobotStore>()((set) => ({
  robots: {},
  trails: {},

  setRobots: (robots) => set({ robots }),

  updateRobot: (id, robot) =>
    set((state) => {
      const prev = state.trails[id] ?? [];
      const lng = robot.position?.longitude;
      const lat = robot.position?.latitude;
      let trail = prev;
      if (lng !== undefined && lat !== undefined) {
        const last = prev[prev.length - 1];
        if (!last || last[0] !== lng || last[1] !== lat) {
          trail = [...prev.slice(-(MAX_TRAIL_POINTS - 1)), [lng, lat] as [number, number]];
        }
      }
      return {
        robots: { ...state.robots, [id]: robot },
        trails: { ...state.trails, [id]: trail },
      };
    }),
}));

// ---------------------------------------------------------------------------
// useMissionStore
// ---------------------------------------------------------------------------

interface MissionStore {
  missions: Record<string, Mission>;
  activeMissionId: string | null;
  setMissions: (missions: Record<string, Mission>) => void;
  updateMission: (mission: Mission) => void;
  setActiveMission: (id: string | null) => void;
}

export const useMissionStore = create<MissionStore>()((set) => ({
  missions: {},
  activeMissionId: null,

  setMissions: (missions) => set({ missions }),

  updateMission: (mission) =>
    set((state) => ({
      missions: { ...state.missions, [mission.id]: mission },
      activeMissionId:
        mission.status === "active" ? mission.id : state.activeMissionId,
    })),

  setActiveMission: (id) => set({ activeMissionId: id }),
}));

// ---------------------------------------------------------------------------
// useCommandStore
// ---------------------------------------------------------------------------

interface CommandStore {
  commands: Record<string, Command>;
  robotCommands: Record<string, string[]>;
  sendFn: ((type: string, payload: unknown) => void) | null;
  setSendFn: (fn: (type: string, payload: unknown) => void) => void;
  addCommand: (cmd: Command) => void;
  updateCommand: (id: string, updates: Partial<Command>) => void;
  sendCommand: (
    robotId: string,
    commandType: string,
    parameters?: Record<string, unknown>
  ) => void;
  sendBatchCommand: (
    robotIds: string[],
    commandType: string,
    parameters?: Record<string, unknown>
  ) => void;
}

export const useCommandStore = create<CommandStore>()((set, get) => ({
  commands: {},
  robotCommands: {},
  sendFn: null,

  setSendFn: (fn) => set({ sendFn: fn }),

  addCommand: (cmd) =>
    set((state) => ({
      commands: { ...state.commands, [cmd.id]: cmd },
      robotCommands: {
        ...state.robotCommands,
        [cmd.robotId]: [
          ...(state.robotCommands[cmd.robotId] || []),
          cmd.id,
        ],
      },
    })),

  updateCommand: (id, updates) =>
    set((state) => {
      const existing = state.commands[id];
      if (!existing) return state;
      return {
        commands: { ...state.commands, [id]: { ...existing, ...updates } },
      };
    }),

  sendCommand: (robotId, commandType, parameters = {}) => {
    const { sendFn } = get();
    if (sendFn) {
      sendFn("command.send", { robotId, commandType, parameters });
    }
  },

  sendBatchCommand: (robotIds, commandType, parameters = {}) => {
    const { sendFn } = get();
    if (sendFn) {
      for (const robotId of robotIds) {
        sendFn("command.send", { robotId, commandType, parameters });
      }
    }
  },
}));

// ---------------------------------------------------------------------------
// useUIStore
// ---------------------------------------------------------------------------

type CommandMode = "none" | "goto" | "set_home" | "set_waypoints" | "circle_area";
type SortBy = "name" | "status" | "battery" | "type";

interface UIStore {
  selectedRobotId: string | null;
  commandMode: CommandMode;
  alertsPanelOpen: boolean;
  settingsPanelOpen: boolean;
  trailsEnabled: boolean;

  // Waypoint builder
  pendingWaypoints: { lat: number; lng: number }[];
  addWaypoint: (lat: number, lng: number) => void;
  undoWaypoint: () => void;
  clearWaypoints: () => void;

  // Circle area builder
  circleCenter: { lat: number; lng: number } | null;
  circleRadius: number;
  setCircleCenter: (center: { lat: number; lng: number } | null) => void;
  setCircleRadius: (radius: number) => void;

  // Multi-select
  selectedRobotIds: string[];
  toggleRobotSelection: (id: string) => void;
  selectAllRobots: (ids: string[]) => void;
  clearSelection: () => void;

  // Search / filter / sort
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  sortBy: SortBy;
  setSortBy: (sort: SortBy) => void;
  filterStatus: RobotStatus | "all";
  setFilterStatus: (status: RobotStatus | "all") => void;

  // Expandable rows
  expandedRobotId: string | null;
  setExpandedRobotId: (id: string | null) => void;

  // Collapse inactive
  collapseInactive: boolean;
  toggleCollapseInactive: () => void;

  // AI lock (per-robot)
  aiLocked: Record<string, boolean>;
  toggleAiLock: (robotId: string) => void;

  // Robot nicknames (client-side renaming)
  robotNicknames: Record<string, string>;
  setRobotNickname: (robotId: string, name: string) => void;

  selectRobot: (id: string | null) => void;
  setCommandMode: (mode: CommandMode) => void;
  toggleAlertsPanel: () => void;
  toggleSettingsPanel: () => void;
  toggleTrails: () => void;
}

export const useUIStore = create<UIStore>()((set) => ({
  selectedRobotId: null,
  commandMode: "none",
  alertsPanelOpen: false,
  settingsPanelOpen: false,
  trailsEnabled: true,

  // Waypoint builder
  pendingWaypoints: [],
  addWaypoint: (lat, lng) =>
    set((s) => ({ pendingWaypoints: [...s.pendingWaypoints, { lat, lng }] })),
  undoWaypoint: () =>
    set((s) => ({ pendingWaypoints: s.pendingWaypoints.slice(0, -1) })),
  clearWaypoints: () => set({ pendingWaypoints: [] }),

  // Circle area builder
  circleCenter: null,
  circleRadius: 150,
  setCircleCenter: (center) => set({ circleCenter: center }),
  setCircleRadius: (radius) => set({ circleRadius: radius }),

  // Multi-select
  selectedRobotIds: [],
  toggleRobotSelection: (id) =>
    set((s) => ({
      selectedRobotIds: s.selectedRobotIds.includes(id)
        ? s.selectedRobotIds.filter((rid) => rid !== id)
        : [...s.selectedRobotIds, id],
    })),
  selectAllRobots: (ids) => set({ selectedRobotIds: ids }),
  clearSelection: () => set({ selectedRobotIds: [] }),

  // Search / filter / sort
  searchQuery: "",
  setSearchQuery: (q) => set({ searchQuery: q }),
  sortBy: "name",
  setSortBy: (sort) => set({ sortBy: sort }),
  filterStatus: "all",
  setFilterStatus: (status) => set({ filterStatus: status }),

  // Expandable rows
  expandedRobotId: null,
  setExpandedRobotId: (id) =>
    set((s) => ({ expandedRobotId: s.expandedRobotId === id ? null : id })),

  // Collapse inactive
  collapseInactive: false,
  toggleCollapseInactive: () =>
    set((s) => ({ collapseInactive: !s.collapseInactive })),

  // AI lock
  aiLocked: {},
  toggleAiLock: (robotId) =>
    set((s) => ({
      aiLocked: { ...s.aiLocked, [robotId]: !s.aiLocked[robotId] },
    })),

  // Robot nicknames
  robotNicknames: {},
  setRobotNickname: (robotId, name) =>
    set((s) => ({
      robotNicknames: { ...s.robotNicknames, [robotId]: name },
    })),

  selectRobot: (id) =>
    set({
      selectedRobotId: id,
      commandMode: "none",
      pendingWaypoints: [],
      circleCenter: null,
    }),

  setCommandMode: (mode) =>
    set({
      commandMode: mode,
      ...(mode === "none" ? { pendingWaypoints: [], circleCenter: null } : {}),
    }),

  toggleAlertsPanel: () =>
    set((state) => ({ alertsPanelOpen: !state.alertsPanelOpen })),

  toggleSettingsPanel: () =>
    set((state) => ({ settingsPanelOpen: !state.settingsPanelOpen })),

  toggleTrails: () =>
    set((state) => ({ trailsEnabled: !state.trailsEnabled })),
}));

// ---------------------------------------------------------------------------
// useAIStore
// ---------------------------------------------------------------------------

interface AIStore {
  suggestions: Record<string, Suggestion>;
  pendingPlan: MissionPlan | null;
  planLoading: boolean;
  planError: string | null;

  // AI quick execute
  executeLoading: boolean;
  lastExplanation: string | null;

  addSuggestion: (suggestion: Suggestion) => void;
  updateSuggestion: (id: string, suggestion: Suggestion) => void;
  removeSuggestion: (id: string) => void;

  approveSuggestion: (id: string) => Promise<void>;
  rejectSuggestion: (id: string) => Promise<void>;

  generatePlan: (intent: MissionIntent) => Promise<void>;
  approvePlan: () => Promise<void>;
  clearPlan: () => void;

  executeAI: (objective: string, selectedRobots?: string[]) => Promise<{ explanation?: string; error?: string }>;
}

export const useAIStore = create<AIStore>()((set, get) => ({
  suggestions: {},
  pendingPlan: null,
  planLoading: false,
  planError: null,
  executeLoading: false,
  lastExplanation: null,

  addSuggestion: (suggestion) =>
    set((s) => ({ suggestions: { ...s.suggestions, [suggestion.id]: suggestion } })),

  updateSuggestion: (id, suggestion) =>
    set((s) => ({ suggestions: { ...s.suggestions, [id]: suggestion } })),

  removeSuggestion: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.suggestions;
      return { suggestions: rest };
    }),

  approveSuggestion: async (id) => {
    const resp = await fetch(`${API_BASE}/api/ai/suggestions/${id}/approve`, { method: "POST" });
    if (resp.ok) {
      const data = await resp.json();
      set((s) => ({ suggestions: { ...s.suggestions, [id]: data } }));
    }
  },

  rejectSuggestion: async (id) => {
    const resp = await fetch(`${API_BASE}/api/ai/suggestions/${id}/reject`, { method: "POST" });
    if (resp.ok) {
      const data = await resp.json();
      set((s) => ({ suggestions: { ...s.suggestions, [id]: data } }));
    }
  },

  generatePlan: async (intent) => {
    set({ planLoading: true, planError: null, pendingPlan: null });
    try {
      const resp = await fetch(`${API_BASE}/api/ai/missions/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent),
      });
      const data = await resp.json();
      if (data.error) {
        set({ planError: data.error, planLoading: false });
      } else {
        set({ pendingPlan: data.plan, planLoading: false });
      }
    } catch {
      set({
        planError: "Could not reach the backend. Ensure the server is running and AI_ENABLED=true is set.",
        planLoading: false,
      });
    }
  },

  approvePlan: async () => {
    const plan = get().pendingPlan;
    if (!plan) return;
    try {
      const resp = await fetch(`${API_BASE}/api/ai/missions/plan/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (resp.ok) {
        set({ pendingPlan: null });
      }
    } catch {
      set({ planError: "Could not reach the backend. Ensure the server is running." });
    }
  },

  clearPlan: () => set({ pendingPlan: null, planError: null }),

  executeAI: async (objective, selectedRobots) => {
    set({ executeLoading: true, lastExplanation: null });
    try {
      const resp = await fetch(`${API_BASE}/api/ai/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective,
          selectedRobots: selectedRobots?.length ? selectedRobots : undefined,
          source: "ai",
        }),
      });
      const data = await resp.json();
      if (data.error) {
        set({ executeLoading: false });
        return { error: data.error };
      }
      set({ executeLoading: false, lastExplanation: data.explanation || null });
      return { explanation: data.explanation };
    } catch {
      set({ executeLoading: false });
      return { error: "Could not reach the backend." };
    }
  },
}));

// ---------------------------------------------------------------------------
// useAutonomyStore
// ---------------------------------------------------------------------------

interface AutonomyStore {
  fleetDefaultTier: AutonomyTier;
  countdowns: Record<string, CountdownSuggestion>;
  changeLog: AutonomyChangeEntry[];

  setFleetDefaultTier: (tier: AutonomyTier) => void;
  addCountdown: (countdown: CountdownSuggestion) => void;
  removeCountdown: (suggestionId: string) => void;
  addChangeLogEntry: (entry: AutonomyChangeEntry) => void;

  setRobotTier: (robotId: string, tier: AutonomyTier) => Promise<void>;
  setFleetDefault: (tier: AutonomyTier) => Promise<void>;
}

export const useAutonomyStore = create<AutonomyStore>()((set) => ({
  fleetDefaultTier: "assisted",
  countdowns: {},
  changeLog: [],

  setFleetDefaultTier: (tier) => set({ fleetDefaultTier: tier }),

  addCountdown: (countdown) =>
    set((s) => ({
      countdowns: { ...s.countdowns, [countdown.suggestionId]: countdown },
    })),

  removeCountdown: (suggestionId) =>
    set((s) => {
      const { [suggestionId]: _, ...rest } = s.countdowns;
      return { countdowns: rest };
    }),

  addChangeLogEntry: (entry) =>
    set((s) => ({
      changeLog: [...s.changeLog.slice(-99), entry],
    })),

  setRobotTier: async (robotId, tier) => {
    const robot = useRobotStore.getState().robots[robotId];
    if (robot) {
      useRobotStore.getState().updateRobot(robotId, { ...robot, autonomyTier: tier });
    }
    try {
      await fetch(`${API_BASE}/api/autonomy/robots/${robotId}/tier`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
    } catch {
      if (robot) {
        useRobotStore.getState().updateRobot(robotId, robot);
      }
    }
  },

  setFleetDefault: async (tier) => {
    const resp = await fetch(`${API_BASE}/api/autonomy/fleet/default-tier`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    if (resp.ok) {
      set({ fleetDefaultTier: tier });
    }
  },
}));

// ===========================================================================
// Hooks
// ===========================================================================

// ---------------------------------------------------------------------------
// useWebSocket
// ---------------------------------------------------------------------------

function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

const WS_URL = getWsUrl();

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | undefined>(undefined);
  const { setConnected, setReconnecting } = useConnectionStore();
  const { setRobots, updateRobot } = useRobotStore();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setReconnecting(false);
      useCommandStore.getState().setSendFn((type: string, payload: unknown) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({ type, payload, timestamp: new Date().toISOString() })
          );
        }
      });
      console.log("[WS] Connected");
    };

    ws.onmessage = (event) => {
      const msg: WSMessage = JSON.parse(event.data);
      switch (msg.type) {
        case "state.sync": {
          const payload = msg.payload as StateSyncPayload;
          setRobots(payload.robots);
          if (payload.missions) {
            useMissionStore.getState().setMissions(payload.missions);
          }
          break;
        }
        case "robot.updated": {
          const robot = msg.payload as RobotUpdatedPayload;
          updateRobot(robot.id, robot);
          break;
        }
        case "command.status": {
          const cmd = msg.payload as Command;
          const store = useCommandStore.getState();
          if (store.commands[cmd.id]) {
            store.updateCommand(cmd.id, cmd);
          } else {
            store.addCommand(cmd);
          }
          break;
        }
        case "mission.updated": {
          const mission = msg.payload as Mission;
          useMissionStore.getState().updateMission(mission);
          break;
        }
        case "ai.suggestion": {
          const suggestion = msg.payload as Suggestion;
          const aiStore = useAIStore.getState();
          if (aiStore.suggestions[suggestion.id]) {
            aiStore.updateSuggestion(suggestion.id, suggestion);
          } else {
            aiStore.addSuggestion(suggestion);
          }
          break;
        }
        case "autonomy.changed": {
          const entry = msg.payload as AutonomyChangeEntry;
          const autoStore = useAutonomyStore.getState();
          autoStore.addChangeLogEntry(entry);
          if (entry.robotId === "__fleet__") {
            autoStore.setFleetDefaultTier(entry.newTier);
          } else {
            const existing = useRobotStore.getState().robots[entry.robotId];
            if (existing) {
              updateRobot(entry.robotId, { ...existing, autonomyTier: entry.newTier });
            }
          }
          break;
        }
        case "autonomy.countdown": {
          const countdown = msg.payload as CountdownSuggestion;
          useAutonomyStore.getState().addCountdown(countdown);
          break;
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      useCommandStore.getState().setSendFn(null as unknown as (type: string, payload: unknown) => void);
      console.log("[WS] Disconnected. Reconnecting in 3s...");
      setReconnecting(true);
      reconnectTimer.current = window.setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [setConnected, setReconnecting, setRobots, updateRobot]);

  const send = useCallback((type: string, payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type, payload, timestamp: new Date().toISOString() })
      );
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { send };
}

// ---------------------------------------------------------------------------
// useTrailData
// ---------------------------------------------------------------------------

interface TrailPoint {
  time: string;
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  speed: number;
}

export function useTrailData(robotId: string | null, minutes: number = 10) {
  const [trail, setTrail] = useState<TrailPoint[]>([]);
  const intervalRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!robotId) {
      setTrail([]);
      return;
    }

    const fetchTrail = async () => {
      try {
        const res = await fetch(`${API_BASE}/robots/${robotId}/trail?minutes=${minutes}`);
        if (res.ok) {
          const data = await res.json();
          setTrail(data.trail || []);
        }
      } catch {
        // Silently ignore fetch errors
      }
    };

    fetchTrail();
    intervalRef.current = window.setInterval(fetchTrail, 10000);

    return () => {
      clearInterval(intervalRef.current);
    };
  }, [robotId, minutes]);

  return trail;
}

// ---------------------------------------------------------------------------
// useKeyboardShortcuts
// ---------------------------------------------------------------------------

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const ui = useUIStore.getState();

      switch (e.key) {
        case "Escape":
          if (ui.commandMode !== "none") {
            ui.setCommandMode("none");
          } else if (ui.selectedRobotIds.length > 0) {
            ui.clearSelection();
          } else if (ui.selectedRobotId) {
            ui.selectRobot(null);
          } else if (ui.alertsPanelOpen) {
            ui.toggleAlertsPanel();
          } else if (ui.settingsPanelOpen) {
            ui.toggleSettingsPanel();
          }
          break;

        case "ArrowDown":
        case "ArrowUp": {
          e.preventDefault();
          const robots = Object.values(useRobotStore.getState().robots);
          if (robots.length === 0) break;
          const currentId = ui.selectedRobotId;
          const currentIdx = currentId ? robots.findIndex((r) => r.id === currentId) : -1;
          let nextIdx: number;
          if (e.key === "ArrowDown") {
            nextIdx = currentIdx < robots.length - 1 ? currentIdx + 1 : 0;
          } else {
            nextIdx = currentIdx > 0 ? currentIdx - 1 : robots.length - 1;
          }
          const next = robots[nextIdx];
          if (next) ui.selectRobot(next.id);
          break;
        }

        case "t":
        case "T":
          ui.toggleTrails();
          break;

        case "a":
        case "A":
          if (!ui.settingsPanelOpen) {
            ui.toggleAlertsPanel();
          }
          break;

        case "s":
        case "S":
          if (!ui.alertsPanelOpen) {
            ui.toggleSettingsPanel();
          }
          break;

        case "/":
          e.preventDefault();
          {
            const searchInput = document.querySelector<HTMLInputElement>(
              'input[placeholder="Search units..."]'
            );
            searchInput?.focus();
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
