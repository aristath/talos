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

function classifySessionKindForFilter(session: {
  kind: string;
  sessionId: string;
  runtime?: "subagent" | "acp";
}): string {
  const lowerSessionId = session.sessionId.toLowerCase();
  if (session.kind === "main") {
    return "main";
  }
  if (session.kind === "cron" || lowerSessionId.includes(":cron:")) {
    return "cron";
  }
  if (lowerSessionId.startsWith("group:")) {
    return "group";
  }
  if (lowerSessionId.includes(":hook:")) {
    return "hook";
  }
  if (lowerSessionId.startsWith("node:") || lowerSessionId.includes(":node:")) {
    return "node";
  }
  if (session.runtime === "acp") {
    return "other";
  }
  return "other";
}

function stripToolMessages<T extends { role: string }>(messages: T[]): T[] {
  return messages.filter((entry) => entry.role !== "tool");
}

const SESSIONS_HISTORY_TEXT_MAX_CHARS = 4000;
const SESSIONS_HISTORY_MAX_BYTES = 80 * 1024;

function redactSensitiveText(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  const patterns = [
    /(sk-[A-Za-z0-9_-]{16,})/g,
    /(xox[baprs]-[A-Za-z0-9-]{10,})/g,
    /(ghp_[A-Za-z0-9]{20,})/g,
    /((?:api[_-]?key|token|password|secret)\s*[:=]\s*)([^\s"']+)/gi,
  ];
  let current = text;
  for (const pattern of patterns) {
    current = current.replace(pattern, (_match, prefix: string, value?: string) => {
      redacted = true;
      if (typeof value === "string") {
        return `${prefix}[REDACTED]`;
      }
      return "[REDACTED]";
    });
  }
  return { text: current, redacted };
}

function truncateText(text: string): { text: string; truncated: boolean } {
  if (text.length <= SESSIONS_HISTORY_TEXT_MAX_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, SESSIONS_HISTORY_TEXT_MAX_CHARS)}\n…(truncated)…`,
    truncated: true,
  };
}

function sanitizeMessage(message: { role: string; text: string; at: string; runId?: string }): {
  message: { role: string; text: string; at: string; runId?: string };
  truncated: boolean;
  redacted: boolean;
} {
  const redacted = redactSensitiveText(message.text);
  const truncated = truncateText(redacted.text);
  return {
    message: {
      ...message,
      text: truncated.text,
    },
    truncated: truncated.truncated,
    redacted: redacted.redacted,
  };
}

function jsonUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function capMessagesByBytes(messages: Array<{ role: string; text: string; at: string; runId?: string }>): {
  items: Array<{ role: string; text: string; at: string; runId?: string }>;
  bytes: number;
  dropped: boolean;
} {
  if (messages.length === 0) {
    return { items: messages, bytes: 2, dropped: false };
  }
  const capped: Array<{ role: string; text: string; at: string; runId?: string }> = [];
  let dropped = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = [messages[index], ...capped];
    if (jsonUtf8Bytes(candidate) > SESSIONS_HISTORY_MAX_BYTES) {
      dropped = true;
      continue;
    }
    capped.unshift(messages[index]);
  }
  if (capped.length > 0) {
    return {
      items: capped,
      bytes: jsonUtf8Bytes(capped),
      dropped,
    };
  }
  const placeholder = [
    {
      role: "assistant",
      text: "[sessions_history omitted: message too large]",
      at: new Date(0).toISOString(),
    },
  ];
  return {
    items: placeholder,
    bytes: jsonUtf8Bytes(placeholder),
    dropped: true,
  };
}

function trimMessages(messages: Array<{ role: string; text: string; at: string; runId?: string }>, limit: number): Array<{
  role: string;
  text: string;
  at: string;
  runId?: string;
}> {
  if (limit <= 0 || messages.length <= limit) {
    return messages;
  }
  return messages.slice(-limit);
}

export function createSessionTools(options: SessionToolsOptions): ToolDefinition[] {
  const names = options.names ?? {};
  const unsupportedSpawnParamKeys = [
    "target",
    "transport",
    "channel",
    "to",
    "threadId",
    "thread_id",
    "replyTo",
    "reply_to",
  ] as const;
  return [
    {
      name: names.list ?? "sessions_list",
      description: "List known sessions",
      async run(args, context) {
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
            if (
              options.canAccessSession &&
              !options.canAccessSession({
                action: "list",
                requesterAgentId: context.agentId,
                ...(context.sessionId ? { requesterSessionId: context.sessionId } : {}),
                session,
              })
            ) {
              return false;
            }
            if (kinds && kinds.size > 0 && !kinds.has(classifySessionKindForFilter(session))) {
              return false;
            }
            if (
              typeof args.spawnedBy === "string" &&
              args.spawnedBy.trim() &&
              session.spawnedBy !== args.spawnedBy.trim()
            ) {
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
            const label = session.label ? ` label=${session.label}` : "";
            const runtime = session.runtime ? ` runtime=${session.runtime}` : "";
            return `${session.sessionId} [${session.kind}] agent=${session.agentId} messages=${session.messages.length}${label}${runtime}`;
          })
          .join("\n");
        return {
          content: content || "No sessions.",
          data: {
            count: filtered.length,
            sessions: filtered.map((session) => ({
              ...session,
              ...(messageLimit > 0
                ? {
                    messages: trimMessages(
                      Boolean(args.includeTools) ? session.messages : stripToolMessages(session.messages),
                      messageLimit,
                    ),
                  }
                : { messages: undefined }),
            })),
            details: {
              count: filtered.length,
              limit,
              activeMinutes,
              messageLimit,
              kinds: kinds ? Array.from(kinds) : undefined,
            },
          },
        };
      },
    },
    {
      name: names.history ?? "sessions_history",
      description: "Show message history for a session",
      async run(args, context) {
        const sessionId =
          typeof args.sessionKey === "string" && args.sessionKey.trim()
            ? args.sessionKey.trim()
            : requiredString(args, "sessionId");
        const limit = toLimit(args.limit, 25, 500);
        const session = options.callbacks.getStatus(sessionId);
        if (!session) {
          return {
            content: `Unknown session: ${sessionId}`,
            data: {
              sessionId,
              status: "error",
              error: `Unknown session: ${sessionId}`,
              details: {
                sessionId,
                status: "error",
              },
            },
          };
        }
        if (
          options.canAccessSession &&
          !options.canAccessSession({
            action: "history",
            requesterAgentId: context.agentId,
            ...(context.sessionId ? { requesterSessionId: context.sessionId } : {}),
            session,
          })
        ) {
          return {
            content: `Access denied for session history: ${sessionId}`,
            data: {
              sessionId,
              status: "forbidden",
              error: `Access denied for session history: ${sessionId}`,
              details: {
                sessionId,
                status: "forbidden",
              },
            },
          };
        }
        const messages = options.callbacks.getHistory(sessionId, limit);
        const visibleMessages = Boolean(args.includeTools) ? messages : stripToolMessages(messages);
        const limitedMessages = trimMessages(visibleMessages, limit);
        const sanitized = limitedMessages.map((message) => sanitizeMessage(message));
        const capped = capMessagesByBytes(sanitized.map((entry) => entry.message));
        return {
          content:
            capped.items
              .map((entry) => `[${entry.at}] ${entry.role}: ${entry.text}`)
              .join("\n") || "No history.",
          data: {
            count: capped.items.length,
            sessionId,
            messages: capped.items,
            includeTools: Boolean(args.includeTools),
            truncated: capped.dropped || sanitized.some((entry) => entry.truncated),
            contentRedacted: sanitized.some((entry) => entry.redacted),
            bytes: capped.bytes,
            details: {
              sessionId,
              count: capped.items.length,
              includeTools: Boolean(args.includeTools),
              limit,
              truncated: capped.dropped || sanitized.some((entry) => entry.truncated),
              contentRedacted: sanitized.some((entry) => entry.redacted),
              bytes: capped.bytes,
            },
          },
        };
      },
    },
    {
      name: names.send ?? "sessions_send",
      description: "Send a message to another session",
      async run(args, context) {
        const asStatusResult = (params: {
          sessionId?: string;
          runId?: string;
          status: "ok" | "accepted" | "timeout" | "error" | "forbidden";
          reply?: string;
          error?: string;
          providerId?: string;
          modelId?: string;
          delivery?: { status: string; mode?: string };
        }) => ({
          content: params.reply ?? params.error ?? "",
          data: {
            ...(params.sessionId ? { sessionId: params.sessionId } : {}),
            ...(params.runId ? { runId: params.runId } : {}),
            status: params.status,
            ...(params.reply ? { reply: params.reply } : {}),
            ...(params.error ? { error: params.error } : {}),
            ...(params.providerId ? { providerId: params.providerId } : {}),
            ...(params.modelId ? { modelId: params.modelId } : {}),
            ...(params.delivery ? { delivery: params.delivery } : {}),
            details: {
              sessionId: params.sessionId,
              runId: params.runId,
              status: params.status,
              error: params.error,
              providerId: params.providerId,
              modelId: params.modelId,
            },
          },
        });
        const sessionIdFromInput = resolveFirstString(args, ["sessionKey", "sessionId"]);
        const label = optionalString(args, "label");
        const labelAgentId = optionalString(args, "agentId");
        if (sessionIdFromInput && label) {
          return asStatusResult({
            status: "error",
            error: "Provide either sessionKey/sessionId or label, not both.",
          });
        }
        const resolvedByLabel =
          label && options.callbacks.resolveSessionByLabel
            ? options.callbacks.resolveSessionByLabel({
                label,
                ...(labelAgentId ? { agentId: labelAgentId } : {}),
                ...(typeof args.spawnedBy === "string" && args.spawnedBy.trim()
                  ? { spawnedBy: args.spawnedBy.trim() }
                  : {}),
              })
            : undefined;
        if (label && !sessionIdFromInput && !resolvedByLabel) {
          return asStatusResult({
            status: "error",
            error: `No session found with label: ${label}`,
          });
        }
        const sessionId = sessionIdFromInput ?? resolvedByLabel ?? requiredString(args, "sessionId");
        const message = resolveFirstString(args, ["message", "text", "prompt"]) ?? requiredString(args, "message");
        const session = options.callbacks.getStatus(sessionId);
        if (!session) {
          return asStatusResult({
            sessionId,
            status: "error",
            error: `Unknown session: ${sessionId}`,
          });
        }
        if (
          options.canAccessSession &&
          !options.canAccessSession({
            action: "send",
            requesterAgentId: context.agentId,
            ...(context.sessionId ? { requesterSessionId: context.sessionId } : {}),
            session,
          })
        ) {
          return asStatusResult({
            sessionId,
            status: "forbidden",
            error: `Access denied for sessions_send: ${sessionId}`,
          });
        }
        let sent: Awaited<ReturnType<typeof options.callbacks.sendToSession>>;
        try {
          sent = await options.callbacks.sendToSession({
            sessionId,
            message,
            requesterAgentId: context.agentId,
            ...(context.workspaceDir ? { workspaceDir: context.workspaceDir } : {}),
            ...(typeof args.timeoutSeconds === "number" && Number.isFinite(args.timeoutSeconds)
              ? { timeoutSeconds: Math.max(0, Math.floor(args.timeoutSeconds)) }
              : {}),
          });
        } catch (error) {
          return asStatusResult({
            sessionId,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
        const status = sent.status ?? "ok";
        const reply = sent.reply ?? sent.text ?? "";
        return asStatusResult({
          sessionId,
          runId: sent.runId,
          status,
          reply: reply || (status === "accepted" ? "Message accepted." : undefined),
          error: sent.error,
          providerId: sent.providerId,
          modelId: sent.modelId,
          delivery: sent.delivery,
        });
      },
    },
    {
      name: names.spawn ?? "sessions_spawn",
      description: "Spawn a sub-session run",
      async run(args, context) {
        const unsupportedParam = unsupportedSpawnParamKeys.find((key) => Object.hasOwn(args, key));
        if (unsupportedParam) {
          throw new TalosError({
            code: "TOOL_FAILED",
            message: `sessions_spawn does not support '${unsupportedParam}'. Use sessions_send for delivery.`,
          });
        }
        const task = resolveFirstString(args, ["task", "prompt", "message"]) ?? requiredString(args, "task");
        const agentId = typeof args.agentId === "string" && args.agentId.trim() ? args.agentId.trim() : context.agentId;
        const runtime = args.runtime === "acp" ? "acp" : "subagent";
        const mode = args.mode === "run" || args.mode === "session" ? args.mode : undefined;
        const cleanup = args.cleanup === "delete" ? "delete" : "keep";
        const sandbox = args.sandbox === "require" ? "require" : "inherit";
        const thread = args.thread === true;
        const label = typeof args.label === "string" && args.label.trim() ? args.label.trim() : undefined;
        const timeoutSecondsCandidate =
          typeof args.runTimeoutSeconds === "number"
            ? args.runTimeoutSeconds
            : typeof args.timeoutSeconds === "number"
              ? args.timeoutSeconds
              : undefined;
        const runTimeoutSeconds =
          typeof timeoutSecondsCandidate === "number" && Number.isFinite(timeoutSecondsCandidate)
            ? Math.max(0, Math.floor(timeoutSecondsCandidate))
            : undefined;
        const attachments = Array.isArray(args.attachments)
          ? (args.attachments as Array<{
              name: string;
              content: string;
              encoding?: "utf8" | "base64";
              mimeType?: string;
            }>)
          : undefined;
        if (runtime === "acp" && Array.isArray(attachments) && attachments.length > 0) {
          throw new TalosError({
            code: "TOOL_FAILED",
            message: "sessions_spawn runtime=acp does not support attachments.",
          });
        }
        const attachMountPath =
          args.attachAs && typeof args.attachAs === "object"
            ? optionalString(args.attachAs as Record<string, unknown>, "mountPath")
            : undefined;
        if (options.canAccessSession && context.sessionId) {
          const requester = options.callbacks.getStatus(context.sessionId);
          if (
            requester &&
            !options.canAccessSession({
              action: "spawn",
              requesterAgentId: context.agentId,
              requesterSessionId: context.sessionId,
              session: requester,
            })
          ) {
            throw new TalosError({
              code: "TOOL_NOT_ALLOWED",
              message: `Access denied for sessions_spawn from ${context.sessionId}`,
            });
          }
        }
        const spawned = await options.callbacks.spawnSession({
          task,
          agentId,
          ...(context.workspaceDir ? { workspaceDir: context.workspaceDir } : {}),
          ...(context.sessionId ? { requesterSessionId: context.sessionId } : {}),
          runtime,
          ...(mode ? { mode } : {}),
          ...(label ? { label } : {}),
          ...(typeof runTimeoutSeconds === "number" ? { timeoutSeconds: runTimeoutSeconds } : {}),
          ...(thread ? { thread } : {}),
          cleanup,
          sandbox,
          ...(attachments ? { attachments } : {}),
          ...(attachMountPath ? { attachMountPath } : {}),
        });
        return {
          content: spawned.text,
          data: {
            ...spawned,
            details: {
              sessionId: spawned.sessionId,
              runId: spawned.runId,
              providerId: spawned.providerId,
              modelId: spawned.modelId,
            },
          },
        };
      },
    },
    {
      name: names.status ?? "session_status",
      description: "Inspect current or target session status",
      async run(args, context) {
        const sessionId =
          typeof args.sessionKey === "string" && args.sessionKey.trim()
            ? args.sessionKey.trim()
            : typeof args.sessionId === "string" && args.sessionId.trim()
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
          return {
            content: `Unknown session: ${sessionId}`,
            data: {
              sessionId,
              status: "error",
              error: `Unknown session: ${sessionId}`,
              details: {
                sessionId,
                status: "error",
              },
            },
          };
        }
        if (
          options.canAccessSession &&
          !options.canAccessSession({
            action: "status",
            requesterAgentId: context.agentId,
            ...(context.sessionId ? { requesterSessionId: context.sessionId } : {}),
            session: status,
          })
        ) {
          return {
            content: `Access denied for session_status: ${sessionId}`,
            data: {
              sessionId,
              status: "forbidden",
              error: `Access denied for session_status: ${sessionId}`,
              details: {
                sessionId,
                status: "forbidden",
              },
            },
          };
        }
        const requestedModel = optionalString(args, "model");
        const effectiveStatus =
          requestedModel && options.callbacks.setModelOverride
            ? options.callbacks.setModelOverride({ sessionId, model: requestedModel }) ?? status
            : status;
        const providerLine = effectiveStatus.providerId ? ` provider=${effectiveStatus.providerId}` : "";
        const modelLine = effectiveStatus.modelId ? ` model=${effectiveStatus.modelId}` : "";
        const overrideLine =
          effectiveStatus.providerOverride || effectiveStatus.modelOverride
            ? ` override=${[effectiveStatus.providerOverride, effectiveStatus.modelOverride]
                .filter(Boolean)
                .join("/")}`
            : "";
        const content = `${effectiveStatus.sessionId} [${effectiveStatus.kind}] agent=${effectiveStatus.agentId}${providerLine}${modelLine}${overrideLine} lastRun=${effectiveStatus.lastRunId ?? "n/a"}`;
        const changedModel =
          requestedModel &&
          options.callbacks.setModelOverride &&
          `${effectiveStatus.providerOverride ?? ""}/${effectiveStatus.modelOverride ?? ""}`.trim().length > 1;
        return {
          content,
          data: {
            ...effectiveStatus,
            status: "ok",
            ...(requestedModel ? { requestedModel } : {}),
            ...(changedModel ? { changedModel: true } : {}),
            details: {
              sessionId: effectiveStatus.sessionId,
              agentId: effectiveStatus.agentId,
              kind: effectiveStatus.kind,
              runtime: effectiveStatus.runtime,
              mode: effectiveStatus.mode,
              label: effectiveStatus.label,
              providerId: effectiveStatus.providerId,
              modelId: effectiveStatus.modelId,
              providerOverride: effectiveStatus.providerOverride,
              modelOverride: effectiveStatus.modelOverride,
              lastRunId: effectiveStatus.lastRunId,
              messageCount: effectiveStatus.messages.length,
              status: "ok",
              ...(requestedModel ? { requestedModel } : {}),
            },
          },
        }
      },
    },
  ];
}
