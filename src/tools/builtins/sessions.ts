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

function optionalString(args: Record<string, unknown>, field: string): string | undefined {
  const value = typeof args[field] === "string" ? String(args[field]).trim() : "";
  return value || undefined;
}

function resolveFirstString(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = optionalString(args, key);
    if (value) {
      return value;
    }
  }
  return undefined;
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
        const activeMinutes = toLimit(args.activeMinutes, 0, 24 * 60);
        const messageLimit = toLimit(args.messageLimit, 0, 20);
        const sessions = options.callbacks.listSessions();
        const kinds = Array.isArray(args.kinds)
          ? new Set(args.kinds.map((value) => String(value).trim()).filter(Boolean))
          : undefined;
        const activeAfterEpoch =
          activeMinutes > 0 ? Date.now() - activeMinutes * 60_000 : undefined;
        const filtered = sessions
          .filter((session) => {
            if (kinds && kinds.size > 0 && !kinds.has(session.kind)) {
              return false;
            }
            if (typeof activeAfterEpoch === "number") {
              const updatedAtEpoch = Date.parse(session.updatedAt);
              if (Number.isFinite(updatedAtEpoch) && updatedAtEpoch < activeAfterEpoch) {
                return false;
              }
            }
            return true;
          })
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
            sessions: filtered.map((session) => ({
              ...session,
              ...(messageLimit > 0
                ? {
                    messages:
                      session.messages.length > messageLimit
                        ? session.messages.slice(-messageLimit)
                        : session.messages,
                  }
                : { messages: undefined }),
            })),
          },
        };
      },
    },
    {
      name: names.history ?? "sessions_history",
      description: "Show message history for a session",
      async run(args) {
        const sessionId =
          typeof args.sessionKey === "string" && args.sessionKey.trim()
            ? args.sessionKey.trim()
            : requiredString(args, "sessionId");
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
            includeTools: Boolean(args.includeTools),
          },
        };
      },
    },
    {
      name: names.send ?? "sessions_send",
      description: "Send a message to another session",
      async run(args, context) {
        const sessionId = resolveFirstString(args, ["sessionKey", "sessionId"]) ?? requiredString(args, "sessionId");
        const message = resolveFirstString(args, ["message", "text", "prompt"]) ?? requiredString(args, "message");
        const sent = await options.callbacks.sendToSession({
          sessionId,
          message,
          requesterAgentId: context.agentId,
          ...(context.workspaceDir ? { workspaceDir: context.workspaceDir } : {}),
          ...(typeof args.timeoutSeconds === "number" && Number.isFinite(args.timeoutSeconds)
            ? { timeoutSeconds: Math.max(0, Math.floor(args.timeoutSeconds)) }
            : {}),
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
        const task = resolveFirstString(args, ["task", "prompt", "message"]) ?? requiredString(args, "task");
        const agentId = typeof args.agentId === "string" && args.agentId.trim() ? args.agentId.trim() : context.agentId;
        const runtime = args.runtime === "acp" ? "acp" : "subagent";
        const mode = args.mode === "run" || args.mode === "session" ? args.mode : undefined;
        const label = typeof args.label === "string" && args.label.trim() ? args.label.trim() : undefined;
        const spawned = await options.callbacks.spawnSession({
          task,
          agentId,
          ...(context.workspaceDir ? { workspaceDir: context.workspaceDir } : {}),
          ...(context.sessionId ? { requesterSessionId: context.sessionId } : {}),
          runtime,
          ...(mode ? { mode } : {}),
          ...(label ? { label } : {}),
          ...(typeof args.runTimeoutSeconds === "number" && Number.isFinite(args.runTimeoutSeconds)
            ? { timeoutSeconds: Math.max(0, Math.floor(args.runTimeoutSeconds)) }
            : {}),
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
