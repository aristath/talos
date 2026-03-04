import { TalosError } from "../../errors.js";
import type { SessionToolsOptions, ToolDefinition } from "../../types.js";

function requiredString(args: Record<string, unknown>, field: string): string {
  const value = typeof args[field] === "string" ? String(args[field]).trim() : "";
  if (!value) {
    throw new TalosError({
      code: "TOOL_FAILED",
      message: `session tool requires a non-empty '${field}' string.`,
    });
  }
  return value;
}

function toLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const asInt = Math.floor(value);
  if (asInt <= 0) {
    return fallback;
  }
  return Math.min(asInt, max);
}

export function createSessionTools(options: SessionToolsOptions): ToolDefinition[] {
  const names = options.names ?? {};
  return [
    {
      name: names.list ?? "sessions_list",
      description: "List known sessions",
      async run(args) {
        const limit = toLimit(args.limit, 25, 200);
        const sessions = options.callbacks.listSessions();
        const kinds = Array.isArray(args.kinds)
          ? new Set(args.kinds.map((value) => String(value).trim()).filter(Boolean))
          : undefined;
        const filtered = sessions
          .filter((session) => (kinds && kinds.size > 0 ? kinds.has(session.kind) : true))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, limit);
        const content = filtered
          .map((session) => {
            return `${session.sessionId} [${session.kind}] agent=${session.agentId} messages=${session.messages.length}`;
          })
          .join("\n");
        return {
          content: content || "No sessions.",
          data: {
            sessions: filtered,
          },
        };
      },
    },
    {
      name: names.history ?? "sessions_history",
      description: "Show message history for a session",
      async run(args) {
        const sessionId = requiredString(args, "sessionId");
        const limit = toLimit(args.limit, 25, 500);
        const messages = options.callbacks.getHistory(sessionId, limit);
        return {
          content:
            messages
              .map((entry) => `[${entry.at}] ${entry.role}: ${entry.text}`)
              .join("\n") || "No history.",
          data: {
            sessionId,
            messages,
          },
        };
      },
    },
    {
      name: names.send ?? "sessions_send",
      description: "Send a message to another session",
      async run(args, context) {
        const sessionId = requiredString(args, "sessionId");
        const message = requiredString(args, "message");
        const sent = await options.callbacks.sendToSession({
          sessionId,
          message,
          requesterAgentId: context.agentId,
          ...(context.workspaceDir ? { workspaceDir: context.workspaceDir } : {}),
        });
        return {
          content: sent.text,
          data: {
            sessionId,
            ...sent,
          },
        };
      },
    },
    {
      name: names.spawn ?? "sessions_spawn",
      description: "Spawn a sub-session run",
      async run(args, context) {
        const task = requiredString(args, "task");
        const agentId = typeof args.agentId === "string" && args.agentId.trim() ? args.agentId.trim() : context.agentId;
        const spawned = await options.callbacks.spawnSession({
          task,
          agentId,
          ...(context.workspaceDir ? { workspaceDir: context.workspaceDir } : {}),
          ...(context.sessionId ? { requesterSessionId: context.sessionId } : {}),
        });
        return {
          content: spawned.text,
          data: spawned,
        };
      },
    },
    {
      name: names.status ?? "session_status",
      description: "Inspect current or target session status",
      async run(args, context) {
        const sessionId =
          typeof args.sessionId === "string" && args.sessionId.trim()
            ? args.sessionId.trim()
            : context.sessionId;
        if (!sessionId) {
          throw new TalosError({
            code: "TOOL_FAILED",
            message: "session_status requires sessionId when run context has no session.",
          });
        }
        const status = options.callbacks.getStatus(sessionId);
        if (!status) {
          throw new TalosError({
            code: "TOOL_FAILED",
            message: `Unknown session: ${sessionId}`,
          });
        }
        return {
          content: `${status.sessionId} [${status.kind}] agent=${status.agentId} lastRun=${status.lastRunId ?? "n/a"}`,
          data: status,
        };
      },
    },
  ];
}
