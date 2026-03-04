import { TalosError } from "../../errors.js";
import type { BrowserToolOptions, CanvasToolOptions, ToolDefinition } from "../../types.js";

const BROWSER_ACTIONS = new Set([
  "status",
  "start",
  "stop",
  "profiles",
  "tabs",
  "open",
  "focus",
  "close",
  "snapshot",
  "screenshot",
  "navigate",
  "act",
  "upload",
  "pdf",
  "trace_start",
  "trace_stop",
]);

const CANVAS_ACTIONS = new Set([
  "present",
  "hide",
  "navigate",
  "eval",
  "snapshot",
  "a2ui_push",
  "a2ui_reset",
]);

function normalizeBrowserAction(action: string): string {
  if (action === "trace.start") {
    return "trace_start";
  }
  if (action === "trace.stop") {
    return "trace_stop";
  }
  return action;
}

function normalizeCanvasAction(action: string): string {
  if (action === "a2ui.pushJSONL") {
    return "a2ui_push";
  }
  if (action === "a2ui.reset") {
    return "a2ui_reset";
  }
  return action;
}

function requiredAction(args: Record<string, unknown>): string {
  const action = typeof args.action === "string" ? args.action.trim() : "";
  if (!action) {
    throw new TalosError({
      code: "TOOL_FAILED",
      message: "browser/canvas tool requires a non-empty 'action' string.",
    });
  }
  return action;
}

function assertAllowedAction(action: string, allowed: ReadonlySet<string>, toolName: string): void {
  if (allowed.has(action)) {
    return;
  }
  throw new TalosError({
    code: "TOOL_FAILED",
    message: `${toolName} action is not supported: ${action}`,
    details: {
      allowedActions: Array.from(allowed),
    },
  });
}

function requireActionParam(args: Record<string, unknown>, field: string, toolName: string, action: string): string {
  const value = typeof args[field] === "string" ? args[field].trim() : "";
  if (value) {
    return value;
  }
  throw new TalosError({
    code: "TOOL_FAILED",
    message: `${toolName} action '${action}' requires a non-empty '${field}' string.`,
  });
}

function assertBrowserActionParams(action: string, args: Record<string, unknown>): void {
  switch (action) {
    case "open":
    case "navigate":
      requireActionParam(args, "url", "browser", action);
      return;
    case "focus":
    case "close": {
      const targetId =
        (typeof args.targetId === "string" ? args.targetId.trim() : "") ||
        (typeof args.tabId === "string" ? args.tabId.trim() : "");
      if (!targetId) {
        throw new TalosError({
          code: "TOOL_FAILED",
          message: `browser action '${action}' requires 'targetId' (or alias 'tabId').`,
        });
      }
      return;
    }
    case "act":
      requireActionParam(args, "kind", "browser", action);
      return;
    default:
      return;
  }
}

function assertCanvasActionParams(action: string, args: Record<string, unknown>): void {
  switch (action) {
    case "present": {
      const target =
        (typeof args.target === "string" ? args.target.trim() : "") ||
        (typeof args.url === "string" ? args.url.trim() : "");
      if (!target) {
        throw new TalosError({
          code: "TOOL_FAILED",
          message: "canvas action 'present' requires 'target' (or alias 'url').",
        });
      }
      return;
    }
    case "navigate": {
      const url =
        (typeof args.url === "string" ? args.url.trim() : "") ||
        (typeof args.target === "string" ? args.target.trim() : "");
      if (!url) {
        throw new TalosError({
          code: "TOOL_FAILED",
          message: "canvas action 'navigate' requires 'url' (or alias 'target').",
        });
      }
      return;
    }
    case "eval":
      requireActionParam(args, "javaScript", "canvas", action);
      return;
    case "a2ui_push": {
      const jsonl =
        (typeof args.jsonl === "string" ? args.jsonl.trim() : "") ||
        (typeof args.jsonlPath === "string" ? args.jsonlPath.trim() : "");
      if (!jsonl) {
        throw new TalosError({
          code: "TOOL_FAILED",
          message: "canvas action 'a2ui_push' requires 'jsonl' or 'jsonlPath'.",
        });
      }
      return;
    }
    default:
      return;
  }
}

export function createBrowserTool(options: BrowserToolOptions): ToolDefinition {
  return {
    name: options.name ?? "browser",
    description: options.description ?? "Run browser/UI automation actions",
    async run(args, context) {
      const action = normalizeBrowserAction(requiredAction(args));
      assertAllowedAction(action, BROWSER_ACTIONS, "browser");
      assertBrowserActionParams(action, args);
      const output = await options.execute({ action, args, context });
      return {
        content: output.content,
        data:
          typeof output.data !== "undefined"
            ? {
                action,
                result: output.data,
              }
            : {
                action,
              },
      };
    },
  };
}

export function createCanvasTool(options: CanvasToolOptions): ToolDefinition {
  return {
    name: options.name ?? "canvas",
    description: options.description ?? "Run canvas automation actions",
    async run(args, context) {
      const action = normalizeCanvasAction(requiredAction(args));
      assertAllowedAction(action, CANVAS_ACTIONS, "canvas");
      assertCanvasActionParams(action, args);
      const output = await options.execute({ action, args, context });
      return {
        content: output.content,
        data:
          typeof output.data !== "undefined"
            ? {
                action,
                result: output.data,
              }
            : {
                action,
              },
      };
    },
  };
}
