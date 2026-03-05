import { SoulSwitchError } from "../../errors.js";
import type { BrowserToolOptions, CanvasToolOptions, ToolDefinition } from "../../types.js";

const BROWSER_ACTIONS = new Set([
  "status",
  "start",
  "stop",
  "profiles",
  "tabs",
  "tab",
  "tab_new",
  "tab_select",
  "tab_close",
  "open",
  "focus",
  "close",
  "snapshot",
  "screenshot",
  "console",
  "errors",
  "requests",
  "response_body",
  "navigate",
  "resize",
  "act",
  "click",
  "type",
  "press",
  "hover",
  "scrollintoview",
  "drag",
  "select",
  "download",
  "wait_download",
  "wait",
  "evaluate",
  "highlight",
  "cookies",
  "cookies_set",
  "cookies_clear",
  "storage_get",
  "storage_set",
  "storage_clear",
  "set_offline",
  "set_headers",
  "set_credentials",
  "set_geolocation",
  "set_media",
  "set_timezone",
  "set_locale",
  "set_device",
  "set_viewport",
  "upload",
  "dialog",
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

const BROWSER_ACT_KINDS = new Set([
  "click",
  "type",
  "press",
  "hover",
  "drag",
  "select",
  "fill",
  "resize",
  "wait",
  "evaluate",
  "close",
  "scrollIntoView",
]);

const LEGACY_BROWSER_ACT_REQUEST_KEYS = [
  "targetId",
  "ref",
  "doubleClick",
  "button",
  "modifiers",
  "text",
  "submit",
  "slowly",
  "key",
  "delayMs",
  "startRef",
  "endRef",
  "values",
  "fields",
  "width",
  "height",
  "timeMs",
  "textGone",
  "selector",
  "url",
  "loadState",
  "fn",
  "timeoutMs",
] as const;

const BROWSER_TOP_LEVEL_ALIASES = {
  target_url: "targetUrl",
  target_id: "targetId",
  tab_id: "tabId",
  prompt_text: "promptText",
  timeout_ms: "timeoutMs",
  output_format: "outputFormat",
  execution_target: "executionTarget",
  target_mode: "targetMode",
} as const;

const BROWSER_REQUEST_ALIASES = {
  target_id: "targetId",
  double_click: "doubleClick",
  delay_ms: "delayMs",
  start_ref: "startRef",
  end_ref: "endRef",
  time_ms: "timeMs",
  text_gone: "textGone",
  load_state: "loadState",
  timeout_ms: "timeoutMs",
} as const;

function normalizeBrowserAction(action: string): string {
  if (action === "tab.new") {
    return "tab_new";
  }
  if (action === "tab.select") {
    return "tab_select";
  }
  if (action === "tab.close") {
    return "tab_close";
  }
  if (action === "trace.start") {
    return "trace_start";
  }
  if (action === "trace.stop") {
    return "trace_stop";
  }
  if (action === "response.body") {
    return "response_body";
  }
  if (action === "wait.download") {
    return "wait_download";
  }
  if (action === "cookies.set") {
    return "cookies_set";
  }
  if (action === "cookies.clear") {
    return "cookies_clear";
  }
  if (action === "storage.get") {
    return "storage_get";
  }
  if (action === "storage.set") {
    return "storage_set";
  }
  if (action === "storage.clear") {
    return "storage_clear";
  }
  if (action === "set.offline") {
    return "set_offline";
  }
  if (action === "set.headers") {
    return "set_headers";
  }
  if (action === "set.credentials") {
    return "set_credentials";
  }
  if (action === "set.geolocation") {
    return "set_geolocation";
  }
  if (action === "set.media") {
    return "set_media";
  }
  if (action === "set.timezone") {
    return "set_timezone";
  }
  if (action === "set.locale") {
    return "set_locale";
  }
  if (action === "set.device") {
    return "set_device";
  }
  if (action === "set.viewport") {
    return "set_viewport";
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
    throw new SoulSwitchError({
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
  throw new SoulSwitchError({
    code: "TOOL_FAILED",
    message: `${toolName} action is not supported: ${action}`,
    details: {
      allowedActions: Array.from(allowed),
    },
  });
}

function normalizeTarget(value: unknown): "sandbox" | "host" | "node" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "sandbox" || normalized === "host" || normalized === "node") {
    return normalized;
  }
  throw new SoulSwitchError({
    code: "TOOL_FAILED",
    message: `Unsupported browser target: ${normalized}`,
  });
}

function normalizeCanvasExecutionTarget(value: unknown): "sandbox" | "host" | "node" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "sandbox" || normalized === "host" || normalized === "node") {
    return normalized;
  }
  throw new SoulSwitchError({
    code: "TOOL_FAILED",
    message: `Unsupported canvas execution target: ${normalized}`,
  });
}

function requireActionParam(args: Record<string, unknown>, field: string, toolName: string, action: string): string {
  const value = typeof args[field] === "string" ? args[field].trim() : "";
  if (value) {
    return value;
  }
  throw new SoulSwitchError({
    code: "TOOL_FAILED",
    message: `${toolName} action '${action}' requires a non-empty '${field}' string.`,
  });
}

function normalizeAliasedKeys(
  args: Record<string, unknown>,
  aliases: Record<string, string>,
): Record<string, unknown> {
  let normalized: Record<string, unknown> | undefined;
  for (const [from, to] of Object.entries(aliases)) {
    if (!Object.hasOwn(args, from) || Object.hasOwn(args, to)) {
      continue;
    }
    normalized ??= { ...args };
    normalized[to] = args[from];
  }
  return normalized ?? args;
}

function readBrowserActRequest(args: Record<string, unknown>): Record<string, unknown> | undefined {
  if (typeof args.request === "object" && args.request && !Array.isArray(args.request)) {
    const normalized = normalizeAliasedKeys(args.request as Record<string, unknown>, BROWSER_REQUEST_ALIASES);
    const rawKind = typeof normalized.kind === "string" ? normalized.kind.trim() : "";
    const kind = rawKind === "scrollintoview" ? "scrollIntoView" : rawKind;
    if (kind && kind !== rawKind) {
      return {
        ...normalized,
        kind,
      };
    }
    return normalized;
  }
  const kind = typeof args.kind === "string" ? args.kind.trim() : "";
  if (!kind) {
    return undefined;
  }
  const request: Record<string, unknown> = { kind };
  for (const key of LEGACY_BROWSER_ACT_REQUEST_KEYS) {
    if (!Object.hasOwn(args, key)) {
      continue;
    }
    request[key] = args[key];
  }
  if (kind === "scrollintoview") {
    request.kind = "scrollIntoView";
  }
  return request;
}

function assertPositiveNumber(value: unknown, message: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new SoulSwitchError({
      code: "TOOL_FAILED",
      message,
    });
  }
}

function normalizeBrowserActionArgs(action: string, args: Record<string, unknown>): Record<string, unknown> {
  if (action === "open" || action === "navigate") {
    const targetUrl = typeof args.targetUrl === "string" ? args.targetUrl.trim() : "";
    if (!args.url && targetUrl) {
      return {
        ...args,
        url: targetUrl,
      };
    }
  }
  if (action === "focus" || action === "close") {
    const tabId = typeof args.tabId === "string" ? args.tabId.trim() : "";
    if (!args.targetId && tabId) {
      return {
        ...args,
        targetId: tabId,
      };
    }
  }
  if (action === "dialog") {
    return {
      ...args,
      accept: typeof args.accept === "boolean" ? args.accept : false,
    };
  }
  if (action === "upload" && Array.isArray(args.paths)) {
    return {
      ...args,
      paths: args.paths.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0),
    };
  }
  return args;
}

function assertBrowserActionParams(action: string, args: Record<string, unknown>): void {
  switch (action) {
    case "open":
    case "navigate":
      {
        const url =
          (typeof args.url === "string" ? args.url.trim() : "") ||
          (typeof args.targetUrl === "string" ? args.targetUrl.trim() : "");
        if (!url) {
          throw new SoulSwitchError({
            code: "TOOL_FAILED",
            message: `browser action '${action}' requires a non-empty 'url' string.`,
          });
        }
      }
      return;
    case "focus": {
      const targetId =
        (typeof args.targetId === "string" ? args.targetId.trim() : "") ||
        (typeof args.tabId === "string" ? args.tabId.trim() : "");
      if (!targetId) {
        throw new SoulSwitchError({
          code: "TOOL_FAILED",
          message: "browser action 'focus' requires 'targetId' (or alias 'tabId').",
        });
      }
      return;
    }
    case "close":
      return;
    case "tab_select": {
      const index = typeof args.index === "number" ? args.index : undefined;
      if (typeof index !== "number" || !Number.isFinite(index) || index < 1) {
        throw new SoulSwitchError({
          code: "TOOL_FAILED",
          message: "browser action 'tab_select' requires numeric 'index' >= 1.",
        });
      }
      return;
    }
    case "act":
      {
        const request = readBrowserActRequest(args);
        if (!request) {
          throw new SoulSwitchError({
            code: "TOOL_FAILED",
            message: "browser action 'act' requires request.kind or kind.",
          });
        }
        const kind = typeof request?.kind === "string" ? request.kind.trim() : "";
        if (!kind) {
          throw new SoulSwitchError({
            code: "TOOL_FAILED",
            message: "browser action 'act' requires request.kind or kind.",
          });
        }
        if (!BROWSER_ACT_KINDS.has(kind)) {
          throw new SoulSwitchError({
            code: "TOOL_FAILED",
            message: `browser action 'act' has unsupported request.kind: ${kind}`,
            details: {
              allowedKinds: Array.from(BROWSER_ACT_KINDS),
            },
          });
        }
        switch (kind) {
          case "click":
          case "hover":
          case "scrollIntoView":
            requireActionParam(request, "ref", "browser act", kind);
            break;
          case "type":
            requireActionParam(request, "ref", "browser act", kind);
            requireActionParam(request, "text", "browser act", kind);
            break;
          case "press":
            requireActionParam(request, "key", "browser act", kind);
            break;
          case "drag":
            requireActionParam(request, "startRef", "browser act", kind);
            requireActionParam(request, "endRef", "browser act", kind);
            break;
          case "select": {
            requireActionParam(request, "ref", "browser act", kind);
            const values = request.values;
            if (!Array.isArray(values) || values.length === 0) {
              throw new SoulSwitchError({
                code: "TOOL_FAILED",
                message: "browser act 'select' requires a non-empty 'values' array.",
              });
            }
            break;
          }
          case "fill": {
            const fields = request.fields;
            if (!Array.isArray(fields) || fields.length === 0) {
              throw new SoulSwitchError({
                code: "TOOL_FAILED",
                message: "browser act 'fill' requires a non-empty 'fields' array.",
              });
            }
            break;
          }
          case "resize":
            assertPositiveNumber(request.width, "browser act 'resize' requires positive numeric 'width'.");
            assertPositiveNumber(request.height, "browser act 'resize' requires positive numeric 'height'.");
            break;
          case "evaluate":
            requireActionParam(request, "fn", "browser act", kind);
            break;
          case "wait": {
            if (Object.hasOwn(request, "loadState")) {
              const loadState = typeof request.loadState === "string" ? request.loadState.trim() : "";
              if (
                loadState &&
                loadState !== "load" &&
                loadState !== "domcontentloaded" &&
                loadState !== "networkidle"
              ) {
                throw new SoulSwitchError({
                  code: "TOOL_FAILED",
                  message:
                    "browser act 'wait' supports loadState: load, domcontentloaded, networkidle.",
                });
              }
            }
            break;
          }
          default:
            break;
        }
      }
      return;
    case "dialog": {
      if (Object.hasOwn(args, "accept") && typeof args.accept !== "boolean") {
        throw new SoulSwitchError({
          code: "TOOL_FAILED",
          message: "browser action 'dialog' requires boolean 'accept' when provided.",
        });
      }
      if (Object.hasOwn(args, "promptText") && typeof args.promptText !== "string") {
        throw new SoulSwitchError({
          code: "TOOL_FAILED",
          message: "browser action 'dialog' requires string 'promptText' when provided.",
        });
      }
      return;
    }
    case "click":
    case "type":
    case "hover":
    case "scrollintoview":
    case "highlight":
      requireActionParam(args, "ref", "browser", action);
      return;
    case "drag":
      requireActionParam(args, "fromRef", "browser", action);
      requireActionParam(args, "toRef", "browser", action);
      return;
    case "download":
      requireActionParam(args, "ref", "browser", action);
      requireActionParam(args, "filename", "browser", action);
      return;
    case "upload": {
      const paths = Array.isArray(args.paths)
        ? args.paths.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [];
      if (paths.length === 0) {
        throw new SoulSwitchError({
          code: "TOOL_FAILED",
          message: "browser action 'upload' requires a non-empty 'paths' array.",
        });
      }
      return;
    }
    case "screenshot": {
      if (!Object.hasOwn(args, "type")) {
        return;
      }
      const type = typeof args.type === "string" ? args.type.trim().toLowerCase() : "";
      if (type === "png" || type === "jpeg") {
        return;
      }
      throw new SoulSwitchError({
        code: "TOOL_FAILED",
        message: "browser action 'screenshot' supports type: png, jpeg.",
      });
    }
    case "snapshot": {
      if (Object.hasOwn(args, "snapshotFormat")) {
        const snapshotFormat =
          typeof args.snapshotFormat === "string" ? args.snapshotFormat.trim().toLowerCase() : "";
        if (snapshotFormat && snapshotFormat !== "ai" && snapshotFormat !== "aria") {
          throw new SoulSwitchError({
            code: "TOOL_FAILED",
            message: "browser action 'snapshot' supports snapshotFormat: ai, aria.",
          });
        }
      }
      if (Object.hasOwn(args, "mode")) {
        const mode = typeof args.mode === "string" ? args.mode.trim().toLowerCase() : "";
        if (mode && mode !== "efficient") {
          throw new SoulSwitchError({
            code: "TOOL_FAILED",
            message: "browser action 'snapshot' supports mode: efficient.",
          });
        }
      }
      if (Object.hasOwn(args, "refs")) {
        const refs = typeof args.refs === "string" ? args.refs.trim().toLowerCase() : "";
        if (refs && refs !== "role" && refs !== "aria") {
          throw new SoulSwitchError({
            code: "TOOL_FAILED",
            message: "browser action 'snapshot' supports refs: role, aria.",
          });
        }
      }
      return;
    }
    case "evaluate":
      requireActionParam(args, "fn", "browser", action);
      return;
    case "wait_download":
      requireActionParam(args, "filename", "browser", action);
      return;
    case "storage_get":
    case "storage_set":
    case "storage_clear":
      requireActionParam(args, "kind", "browser", action);
      return;
    case "set_timezone":
      requireActionParam(args, "timezone", "browser", action);
      return;
    case "set_locale":
      requireActionParam(args, "locale", "browser", action);
      return;
    case "set_device":
      requireActionParam(args, "device", "browser", action);
      return;
    case "set_viewport": {
      const width = typeof args.width === "number" ? args.width : NaN;
      const height = typeof args.height === "number" ? args.height : NaN;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new SoulSwitchError({
          code: "TOOL_FAILED",
          message: "browser action 'set_viewport' requires positive numeric width and height.",
        });
      }
      return;
    }
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
        throw new SoulSwitchError({
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
        throw new SoulSwitchError({
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
        throw new SoulSwitchError({
          code: "TOOL_FAILED",
          message: "canvas action 'a2ui_push' requires 'jsonl' or 'jsonlPath'.",
        });
      }
      return;
    }
    case "snapshot": {
      if (!Object.hasOwn(args, "outputFormat")) {
        return;
      }
      const outputFormat = typeof args.outputFormat === "string" ? args.outputFormat.trim().toLowerCase() : "";
      if (outputFormat === "png" || outputFormat === "jpg" || outputFormat === "jpeg") {
        return;
      }
      throw new SoulSwitchError({
        code: "TOOL_FAILED",
        message: "canvas action 'snapshot' supports outputFormat: png, jpg, jpeg.",
      });
    }
    default:
      return;
  }
}

function normalizeCanvasActionArgs(action: string, args: Record<string, unknown>): Record<string, unknown> {
  if (action === "present") {
    const target = typeof args.target === "string" ? args.target.trim() : "";
    const url = typeof args.url === "string" ? args.url.trim() : "";
    if (!target && url) {
      return {
        ...args,
        target: url,
      };
    }
  }
  if (action === "navigate") {
    const target = typeof args.target === "string" ? args.target.trim() : "";
    const url = typeof args.url === "string" ? args.url.trim() : "";
    if (!url && target) {
      return {
        ...args,
        url: target,
      };
    }
  }
  if (action === "a2ui_push") {
    const jsonl = typeof args.jsonl === "string" ? args.jsonl.trim() : "";
    const jsonlPath = typeof args.jsonlPath === "string" ? args.jsonlPath.trim() : "";
    if (!jsonl && jsonlPath) {
      return {
        ...args,
        jsonl: jsonlPath,
      };
    }
  }
  return args;
}

function externalBrowserContentDetails(action: string): { untrusted: boolean; source: string; kind: string; wrapped: boolean } | undefined {
  if (action === "snapshot" || action === "console" || action === "tabs" || action === "errors" || action === "requests") {
    return {
      untrusted: true,
      source: "browser",
      kind: action,
      wrapped: false,
    };
  }
  return undefined;
}

export function createBrowserTool(options: BrowserToolOptions): ToolDefinition {
  return {
    name: options.name ?? "browser",
    description: options.description ?? "Run browser/UI automation actions",
    async run(args, context) {
      const inputArgs = normalizeAliasedKeys(args, BROWSER_TOP_LEVEL_ALIASES);
      const action = normalizeBrowserAction(requiredAction(inputArgs));
      assertAllowedAction(action, BROWSER_ACTIONS, "browser");
      assertBrowserActionParams(action, inputArgs);
      const actRequest = action === "act" ? readBrowserActRequest(inputArgs) : undefined;
      const actionArgs = normalizeBrowserActionArgs(action, inputArgs);
      const normalizedArgs =
        action === "act" && actRequest
          ? {
              ...actionArgs,
              ...actRequest,
              request: actRequest,
            }
          : actionArgs;
      const profile =
        typeof inputArgs.profile === "string" && inputArgs.profile.trim() ? inputArgs.profile.trim() : undefined;
      const target = normalizeTarget(inputArgs.target);
      const node = typeof inputArgs.node === "string" && inputArgs.node.trim() ? inputArgs.node.trim() : undefined;
      if (node && target && target !== "node") {
        throw new SoulSwitchError({
          code: "TOOL_FAILED",
          message: 'browser parameter "node" requires target="node" when target is provided.',
        });
      }
      const resolvedTarget = target ?? (node ? "node" : profile === "chrome" ? "host" : undefined);
      const explicitTarget = typeof normalizedArgs.target === "string" ? normalizedArgs.target.trim() : "";
      const executeArgs =
        resolvedTarget && !explicitTarget
          ? {
              ...normalizedArgs,
              target: resolvedTarget,
            }
          : normalizedArgs;
      const output = await options.execute({ action, args: executeArgs, context });
      return {
        content: output.content,
        data:
          typeof output.data !== "undefined"
            ? {
                action,
                ...(profile ? { profile } : {}),
                ...(resolvedTarget ? { target: resolvedTarget } : {}),
                ...(node ? { node } : {}),
                result: output.data,
                details: {
                  action,
                  profile,
                  target: resolvedTarget,
                  node,
                  ...(externalBrowserContentDetails(action)
                    ? { externalContent: externalBrowserContentDetails(action) }
                    : {}),
                },
              }
            : {
                action,
                ...(profile ? { profile } : {}),
                ...(resolvedTarget ? { target: resolvedTarget } : {}),
                ...(node ? { node } : {}),
                details: {
                  action,
                  profile,
                  target: resolvedTarget,
                  node,
                  ...(externalBrowserContentDetails(action)
                    ? { externalContent: externalBrowserContentDetails(action) }
                    : {}),
                },
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
      const inputArgs = normalizeAliasedKeys(args, BROWSER_TOP_LEVEL_ALIASES);
      const action = normalizeCanvasAction(requiredAction(inputArgs));
      assertAllowedAction(action, CANVAS_ACTIONS, "canvas");
      assertCanvasActionParams(action, inputArgs);
      const normalizedArgs = normalizeCanvasActionArgs(action, inputArgs);
      const executionTarget =
        normalizeCanvasExecutionTarget(inputArgs.executionTarget) ??
        normalizeCanvasExecutionTarget(inputArgs.targetMode);
      const node = typeof inputArgs.node === "string" && inputArgs.node.trim() ? inputArgs.node.trim() : undefined;
      const resolvedExecutionTarget = executionTarget ?? (node ? "node" : undefined);
      const explicitTarget = typeof normalizedArgs.executionTarget === "string" ? normalizedArgs.executionTarget.trim() : "";
      const executeArgs =
        resolvedExecutionTarget && !explicitTarget
          ? {
              ...normalizedArgs,
              executionTarget: resolvedExecutionTarget,
            }
          : normalizedArgs;
      const output = await options.execute({ action, args: executeArgs, context });
      return {
        content: output.content,
        data:
          typeof output.data !== "undefined"
            ? {
                action,
                ...(resolvedExecutionTarget ? { target: resolvedExecutionTarget } : {}),
                ...(node ? { node } : {}),
                result: output.data,
                details: {
                  action,
                  target: resolvedExecutionTarget,
                  node,
                },
              }
            : {
                action,
                ...(resolvedExecutionTarget ? { target: resolvedExecutionTarget } : {}),
                ...(node ? { node } : {}),
                details: {
                  action,
                  target: resolvedExecutionTarget,
                  node,
                },
              },
      };
    },
  };
}
