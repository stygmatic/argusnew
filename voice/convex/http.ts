import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

/**
 * Vapi tool-call webhook endpoint.
 *
 * Vapi sends POST requests when the voice agent invokes a tool.
 * Payload shape: { message: { toolCalls: [{ id, function: { name, arguments } }] } }
 * Expected response: { results: [{ toolCallId, result }] }
 */
http.route({
  path: "/vapi/tool-call",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const toolCalls = body?.message?.toolCalls ?? [];

      if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        return new Response(
          JSON.stringify({ results: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      const results = [];

      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id;
        const functionName = toolCall.function?.name;
        const args = toolCall.function?.arguments
          ? typeof toolCall.function.arguments === "string"
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments
          : {};

        let result: string;

        try {
          switch (functionName) {
            case "dispatchDrones":
              result = await ctx.runAction(api.actions.fleetCommands.dispatchDrones, {
                location: args.location ?? "",
                count: args.count,
                missionType: args.missionType,
                callId: args.callId,
              });
              break;

            case "getFleetStatus":
              result = await ctx.runAction(api.actions.fleetCommands.getFleetStatus, {
                callId: args.callId,
              });
              break;

            case "recallRobots":
              result = await ctx.runAction(api.actions.fleetCommands.recallRobots, {
                robotIds: args.robotIds,
                callId: args.callId,
              });
              break;

            case "stopRobots":
              result = await ctx.runAction(api.actions.fleetCommands.stopRobots, {
                robotIds: args.robotIds,
                callId: args.callId,
              });
              break;

            case "createSurveillanceMission":
              result = await ctx.runAction(api.actions.fleetCommands.createSurveillanceMission, {
                location: args.location ?? "",
                radius: args.radius,
                duration: args.duration,
                callId: args.callId,
              });
              break;

            case "executeAICommand":
              result = await ctx.runAction(api.actions.fleetCommands.executeAICommand, {
                instruction: args.instruction ?? "",
                callId: args.callId,
              });
              break;

            default:
              result = `Unknown command "${functionName}". Available: dispatchDrones, getFleetStatus, recallRobots, stopRobots, createSurveillanceMission, executeAICommand.`;
          }
        } catch {
          result = "System error — please repeat your command.";
        }

        results.push({ toolCallId, result });
      }

      return new Response(
        JSON.stringify({ results }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch {
      // Top-level catch — Vapi should never get an HTTP error
      return new Response(
        JSON.stringify({
          results: [{ toolCallId: "error", result: "System error — please repeat your command." }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
});

// Health check endpoint
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
