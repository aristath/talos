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

export function createBrowserTool(options: BrowserToolOptions): ToolDefinition {
  return {
    name: options.name ?? "browser",
    description: options.description ?? "Run browser/UI automation actions",
    async run(args, context) {
      const action = requiredAction(args);
      assertAllowedAction(action, BROWSER_ACTIONS, "browser");
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
      const action = requiredAction(args);
      assertAllowedAction(action, CANVAS_ACTIONS, "canvas");
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
