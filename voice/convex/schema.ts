import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  voiceCommands: defineTable({
    callId: v.string(),
    robotId: v.string(),
    commandType: v.string(),
    parameters: v.any(),
    status: v.string(), // sent | failed
    backendCommandId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_call", ["callId"]),

  callLog: defineTable({
    callId: v.string(),
    callerNumber: v.optional(v.string()),
    summary: v.optional(v.string()),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    commandCount: v.number(),
  }).index("by_callId", ["callId"]),
});
