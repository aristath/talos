import { TalosError } from "../../errors.js";
import type { BrowserToolOptions, CanvasToolOptions, ToolDefinition } from "../../types.js";

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

export function createBrowserTool(options: BrowserToolOptions): ToolDefinition {
  return {
    name: options.name ?? "browser",
    description: options.description ?? "Run browser/UI automation actions",
    async run(args, context) {
      const action = requiredAction(args);
      const output = await options.execute({ action, args, context });
      return {
        content: output.content,
        ...(typeof output.data !== "undefined" ? { data: output.data } : {}),
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
      const output = await options.execute({ action, args, context });
      return {
        content: output.content,
        ...(typeof output.data !== "undefined" ? { data: output.data } : {}),
      };
    },
  };
}
