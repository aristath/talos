import { randomUUID } from "node:crypto";
import { talosConfigSchema } from "./config/schema.js";
import { AgentRegistry } from "./agents/registry.js";
import { ModelRegistry } from "./models/registry.js";
import { createOpenAICompatibleProvider } from "./models/openai-compatible.js";
import {
  loadPersonaSnapshot,
  buildPersonaSystemPrompt,
  filterPersonaFilesForContextMode,
} from "./persona/loader.js";
import { seedPersonaWorkspace } from "./persona/bootstrap.js";
import { resolvePersonaSessionKind } from "./persona/session-kind.js";
import type { PersonaSnapshot } from "./persona/types.js";
import { PluginRegistry } from "./plugins/registry.js";
import { discoverPluginEntryPaths, loadPluginFromPath } from "./plugins/loader.js";
import { TALOS_PLUGIN_API_VERSION, assertPluginCompatibility } from "./plugin-sdk.js";
import { ToolRegistry } from "./tools/registry.js";
import { createWebFetchTool, createWebSearchTool } from "./tools/builtins/web.js";
import { createImageTool, createPdfTool } from "./tools/builtins/media.js";
import { createBrowserTool, createCanvasTool } from "./tools/builtins/browser-ui.js";
import { createSessionTools } from "./tools/builtins/sessions.js";
import { createLlmTaskTool } from "./tools/builtins/llm-task.js";
import { TalosError, toTalosErrorLike } from "./errors.js";
import { LifecycleEventBus } from "./observability/events.js";
import { loadStateSnapshot, saveStateSnapshot } from "./observability/persistence.js";
import type {
  AgentDefinition,
  AuthProfile,
  ModelProviderAdapter,
  RunInput,
  RunResult,
  Talos,
  TalosConfig,
  TalosPlugin,
  ToolDefinition,
  PluginCapability,
  RunLifecycleListener,
  RunLifecycleUnsubscribe,
  ModelResponse,
  ToolExecutionInput,
  ToolResult,
  SessionRecord,
  ActiveRun,
  RunSummary,
  RunQuery,
  EventQuery,
  RunStats,
  TalosDiagnostics,
  PluginSummary,
  DiagnosticsResetResult,
  TalosStateSnapshot,
} from "./types.js";

const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES_PER_MODEL = 0;
const DEFAULT_RETRY_DELAY_MS = 0;
const DEFAULT_TOOL_EXECUTION_TIMEOUT_MS = 30_000;
const DEFAULT_TOOL_LOOP_MAX_STEPS = 0;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assertRunNotAborted(signal: AbortSignal | undefined, runId: string): void {
  if (!signal?.aborted) {
    return;
  }
  throw new TalosError({
    code: "RUN_CANCELLED",
    message: `Run ${runId} was cancelled.`,
  });
}

function assertToolNotAborted(signal: AbortSignal | undefined, toolName: string): void {
  if (!signal?.aborted) {
    return;
  }
  throw new TalosError({
    code: "TOOL_CANCELLED",
    message: `Tool execution was cancelled: ${toolName}`,
  });
}

function sanitizePersonaSnapshot(snapshot: PersonaSnapshot): PersonaSnapshot {
  const diagnostics = [...snapshot.diagnostics];
  const bootstrapFiles = snapshot.bootstrapFiles
    .filter((file) => {
      const pathValue = typeof file.path === "string" ? file.path.trim() : "";
      if (pathValue.length > 0) {
        return true;
      }
      diagnostics.push({
        path: "",
        reason: "io",
        detail: `skipping bootstrap file \"${file.name}\" due to invalid path from hook override`,
      });
      return false;
    })
    .map((file) => ({ ...file, path: file.path.trim() }));
  return {
    ...snapshot,
    bootstrapFiles,
    diagnostics,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  timeoutCode: "MODEL_TIMEOUT" | "TOOL_TIMEOUT" = "MODEL_TIMEOUT",
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new TalosError({
              code: timeoutCode,
              message: timeoutMessage,
            }),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

type ParsedToolLoopResponse = {
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  final?: string;
};

function parseToolLoopResponse(text: string): ParsedToolLoopResponse | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const candidate = parsed as {
    tool?: unknown;
    args?: unknown;
    toolCalls?: unknown;
    final?: unknown;
  };

  const singleTool =
    typeof candidate.tool === "string" && candidate.tool.trim()
      ? [
          {
            name: candidate.tool.trim(),
            args:
              candidate.args && typeof candidate.args === "object" && !Array.isArray(candidate.args)
                ? (candidate.args as Record<string, unknown>)
                : {},
          },
        ]
      : [];

  const manyTools = Array.isArray(candidate.toolCalls)
    ? candidate.toolCalls
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const e = entry as { name?: unknown; args?: unknown };
          if (typeof e.name !== "string" || !e.name.trim()) {
            return null;
          }
          return {
            name: e.name.trim(),
            args: e.args && typeof e.args === "object" && !Array.isArray(e.args)
              ? (e.args as Record<string, unknown>)
              : {},
          };
        })
        .filter((entry): entry is { name: string; args: Record<string, unknown> } => Boolean(entry))
    : [];

  const toolCalls = manyTools.length > 0 ? manyTools : singleTool;
  const final = typeof candidate.final === "string" && candidate.final.trim() ? candidate.final : undefined;
  if (toolCalls.length === 0) {
    return null;
  }
  return {
    toolCalls,
    ...(final ? { final } : {}),
  };
}

export function createTalos(config: TalosConfig): Talos {
  const parsed = talosConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new TalosError({
      code: "CONFIG_INVALID",
      message: "Talos configuration is invalid.",
      cause: parsed.error,
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }
  const agents = new AgentRegistry();
  const models = new ModelRegistry();
  const tools = new ToolRegistry();
  const plugins = new PluginRegistry();
  const events = new LifecycleEventBus();
  const activeRuns = new Map<
    string,
    {
      meta: ActiveRun;
      controller: AbortController;
      detachExternalAbort?: () => void;
    }
  >();
  const pluginOwnedTools = new Map<string, Set<string>>();
  const pluginOwnedProviders = new Map<string, Set<string>>();
  const personaSnapshotCache = new Map<string, PersonaSnapshot>();
  const sessions = new Map<string, SessionRecord>();
  const pluginTeardowns = new Map<string, () => void | Promise<void>>();
  const pluginCapabilities = new Map<string, PluginCapability[]>();
  const pluginApiVersions = new Map<string, number>();
  const authProfiles = new Map<string, AuthProfile>();
  const requestTimeoutMs = parsed.data.models?.requestTimeoutMs ?? DEFAULT_MODEL_REQUEST_TIMEOUT_MS;
  const retriesPerModel = parsed.data.models?.retriesPerModel ?? DEFAULT_RETRIES_PER_MODEL;
  const retryDelayMs = parsed.data.models?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const toolLoopMaxSteps = parsed.data.models?.toolLoopMaxSteps ?? DEFAULT_TOOL_LOOP_MAX_STEPS;
  const toolExecutionTimeoutMs =
    parsed.data.tools?.executionTimeoutMs ?? DEFAULT_TOOL_EXECUTION_TIMEOUT_MS;
  const defaultStateFile = parsed.data.runtime?.stateFile?.trim();
  const redactKeys = parsed.data.security?.redactKeys;

  for (const [id, profile] of Object.entries(parsed.data.authProfiles ?? {})) {
    authProfiles.set(id.trim(), {
      id: id.trim(),
      ...(profile.apiKey ? { apiKey: profile.apiKey } : {}),
      ...(profile.headers ? { headers: profile.headers } : {}),
    });
  }

  const hasCapability = (pluginCapabilities: PluginCapability[] | undefined, needed: PluginCapability) => {
    return pluginCapabilities?.includes(needed) ?? false;
  };

  const normalizeToolName = (name: string) => name.trim().toLowerCase();
  const toolAllowlist = new Set((parsed.data.tools?.allow ?? []).map(normalizeToolName));
  const toolDenylist = new Set((parsed.data.tools?.deny ?? []).map(normalizeToolName));

  const toNormalizedSet = (values?: string[]) => {
    return new Set((values ?? []).map(normalizeToolName).filter((value) => value.length > 0));
  };

  const assertToolAllowed = (params: {
    name: string;
    agentId?: string;
    policy?: {
      allow?: string[];
      deny?: string[];
    };
  }) => {
    const { name, agentId, policy } = params;
    const normalized = normalizeToolName(name);

    const agent = agentId && agents.has(agentId) ? agents.resolve(agentId) : undefined;
    const agentAllow = toNormalizedSet(agent?.tools?.allow);
    const agentDeny = toNormalizedSet(agent?.tools?.deny);
    const runAllow = toNormalizedSet(policy?.allow);
    const runDeny = toNormalizedSet(policy?.deny);

    if (toolDenylist.has(normalized)) {
      throw new TalosError({
        code: "TOOL_NOT_ALLOWED",
        message: `Tool is denied by global configuration: ${name}`,
      });
    }
    if (agentDeny.has(normalized)) {
      throw new TalosError({
        code: "TOOL_NOT_ALLOWED",
        message: `Tool is denied by agent policy: ${name}`,
      });
    }
    if (runDeny.has(normalized)) {
      throw new TalosError({
        code: "TOOL_NOT_ALLOWED",
        message: `Tool is denied by run policy: ${name}`,
      });
    }
    if (toolAllowlist.size > 0 && !toolAllowlist.has(normalized)) {
      throw new TalosError({
        code: "TOOL_NOT_ALLOWED",
        message: `Tool is not in global allowlist: ${name}`,
      });
    }
    if (agentAllow.size > 0 && !agentAllow.has(normalized)) {
      throw new TalosError({
        code: "TOOL_NOT_ALLOWED",
        message: `Tool is not in agent allowlist: ${name}`,
      });
    }
    if (runAllow.size > 0 && !runAllow.has(normalized)) {
      throw new TalosError({
        code: "TOOL_NOT_ALLOWED",
        message: `Tool is not in run allowlist: ${name}`,
      });
    }
  };

  for (const provider of parsed.data.providers.openaiCompatible) {
    const profile = provider.authProfileId ? authProfiles.get(provider.authProfileId) : undefined;
    const resolvedApiKey = provider.apiKey ?? profile?.apiKey;
    const resolvedHeaders = provider.headers || profile?.headers
      ? { ...(profile?.headers ?? {}), ...(provider.headers ?? {}) }
      : undefined;
    const providerConfig = {
      id: provider.id,
      baseUrl: provider.baseUrl,
      ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
      ...(resolvedHeaders ? { headers: resolvedHeaders } : {}),
    };
    models.register(
      createOpenAICompatibleProvider(providerConfig),
    );
  }

  const registerModelProvider = (provider: ModelProviderAdapter) => {
    models.register(provider);
  };

  const listModelProviders = (): ModelProviderAdapter[] => {
    return models.list();
  };

  const hasModelProvider = (providerId: string): boolean => {
    return models.has(providerId);
  };

  const removeModelProvider = (providerId: string): boolean => {
    return models.remove(providerId);
  };

  const registerAuthProfile = (profile: AuthProfile): void => {
    const normalizedId = profile.id.trim();
    if (!normalizedId) {
      throw new TalosError({
        code: "CONFIG_INVALID",
        message: "Auth profile id is required.",
      });
    }
    authProfiles.set(normalizedId, {
      id: normalizedId,
      ...(profile.apiKey ? { apiKey: profile.apiKey } : {}),
      ...(profile.headers ? { headers: profile.headers } : {}),
    });
  };

  const listAuthProfiles = (): AuthProfile[] => {
    return Array.from(authProfiles.values());
  };

  const hasAuthProfile = (profileId: string): boolean => {
    return authProfiles.has(profileId.trim());
  };

  const removeAuthProfile = (profileId: string): boolean => {
    const normalizedId = profileId.trim();
    if (!normalizedId) {
      return false;
    }
    return authProfiles.delete(normalizedId);
  };

  const registerTool = (tool: ToolDefinition) => {
    assertToolAllowed({ name: tool.name });
    tools.register(tool);
  };

  const registerWebTools = (options: {
    search: Parameters<typeof createWebSearchTool>[0];
    fetch?: Parameters<typeof createWebFetchTool>[0];
  }) => {
    registerTool(createWebSearchTool(options.search));
    registerTool(createWebFetchTool(options.fetch));
  };

  const registerMediaTools = (options: {
    image: Parameters<typeof createImageTool>[0];
    pdf: Parameters<typeof createPdfTool>[0];
  }) => {
    registerTool(createImageTool(options.image));
    registerTool(createPdfTool(options.pdf));
  };

  const registerBrowserTools = (options: Parameters<typeof createBrowserTool>[0]) => {
    registerTool(createBrowserTool(options));
  };

  const registerCanvasTools = (options: Parameters<typeof createCanvasTool>[0]) => {
    registerTool(createCanvasTool(options));
  };

  const listSessionsSnapshot = (): SessionRecord[] => {
    return Array.from(sessions.values()).map((session) => ({
      ...session,
      messages: [...session.messages],
    }));
  };

  const registerSessionTools = () => {
    const sessionTools = createSessionTools({
      callbacks: {
        listSessions: () => listSessionsSnapshot(),
        getHistory: (sessionId, limit) => {
          const session = sessions.get(sessionId.trim());
          if (!session) {
            return [];
          }
          return session.messages.slice(-Math.max(1, limit));
        },
        sendToSession: async (params) => {
          const target = sessions.get(params.sessionId.trim());
          if (!target) {
            throw new TalosError({
              code: "TOOL_FAILED",
              message: `Unknown session: ${params.sessionId}`,
            });
          }
          const result = await run({
            agentId: target.agentId,
            prompt: params.message,
            sessionId: target.sessionId,
            sessionKind: target.kind,
            ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
          });
          return {
            runId: result.runId,
            text: result.text,
            providerId: result.providerId,
            modelId: result.modelId,
          };
        },
        spawnSession: async (params) => {
          const runtime = params.runtime === "acp" ? "subagent" : "subagent";
          const sessionId = `agent:${params.agentId}:${runtime}:${randomUUID().slice(0, 8)}`;
          const result = await run({
            agentId: params.agentId,
            prompt: params.task,
            sessionId,
            sessionKind: "subagent",
            ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
          });
          return {
            sessionId,
            runId: result.runId,
            text: result.text,
            providerId: result.providerId,
            modelId: result.modelId,
          };
        },
        getStatus: (sessionId) => {
          const record = sessions.get(sessionId.trim());
          if (!record) {
            return undefined;
          }
          return {
            ...record,
            messages: [...record.messages],
          };
        },
      },
    });
    for (const tool of sessionTools) {
      registerTool(tool);
    }
  };

  const registerLlmTaskTool = (options?: {
    name?: string;
    description?: string;
    validateJson?: Parameters<typeof createLlmTaskTool>[0]["validateJson"];
  }) => {
    registerTool(
      createLlmTaskTool({
        ...(options?.name ? { name: options.name } : {}),
        ...(options?.description ? { description: options.description } : {}),
        ...(options?.validateJson ? { validateJson: options.validateJson } : {}),
        generate: async (params) => {
          const providerId = params.providerId ?? parsed.data.providers.openaiCompatible[0]?.id;
          const modelId = params.modelId ?? parsed.data.providers.openaiCompatible[0]?.defaultModel;
          if (!providerId || !modelId) {
            throw new TalosError({
              code: "PROVIDER_NOT_FOUND",
              message: "llm_task could not resolve provider/model.",
            });
          }
          let inputJson = "null";
          if (Object.hasOwn(params, "input")) {
            try {
              inputJson = JSON.stringify(params.input ?? null, null, 2);
            } catch {
              throw new TalosError({
                code: "TOOL_FAILED",
                message: "llm_task input must be JSON-serializable.",
              });
            }
          }
          const system = [
            "You are a JSON-only function.",
            "Return ONLY a valid JSON value.",
            "Do not wrap in markdown fences.",
            "Do not include commentary.",
          ].join(" ");
          const fullPrompt = `TASK:\n${params.prompt}\n\nINPUT_JSON:\n${inputJson}\n`;
          const timeoutMs =
            typeof params.timeoutMs === "number" && params.timeoutMs > 0
              ? Math.floor(params.timeoutMs)
              : requestTimeoutMs;
          const response = await withTimeout(
            models.generate({
              providerId,
              modelId,
              system,
              prompt: fullPrompt,
              ...(params.authProfileId ? { authProfileId: params.authProfileId } : {}),
              ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
              ...(typeof params.maxTokens === "number" ? { maxTokens: Math.floor(params.maxTokens) } : {}),
            }),
            timeoutMs,
            `llm_task request timed out after ${timeoutMs}ms (${providerId}/${modelId}).`,
            "MODEL_TIMEOUT",
          );
          return response.text;
        },
      }),
    );
  };

  const listTools = (): ToolDefinition[] => {
    return tools.list();
  };

  const hasTool = (toolName: string): boolean => {
    return tools.has(toolName);
  };

  const removeTool = (toolName: string): boolean => {
    return tools.remove(toolName);
  };

  const registerAgent = (agent: AgentDefinition) => {
    agents.register(agent);
  };

  const listAgents = (): AgentDefinition[] => {
    return agents.list();
  };

  const hasAgent = (agentId: string): boolean => {
    return agents.has(agentId);
  };

  const removeAgent = (agentId: string): boolean => {
    return agents.remove(agentId);
  };

  const registerPlugin = async (plugin: TalosPlugin) => {
    plugins.assertNotRegistered(plugin.id);
    const normalizedPluginId = plugin.id.trim();
    assertPluginCompatibility(plugin);
    const apiVersion = plugin.apiVersion ?? TALOS_PLUGIN_API_VERSION;
    const capabilities = plugin.capabilities ?? ["tools", "providers", "hooks"];
    const ownedTools = new Set<string>();
    const ownedProviders = new Set<string>();
    const teardown = await plugin.setup({
      apiVersion: TALOS_PLUGIN_API_VERSION,
      registerTool: (tool) => {
        if (!hasCapability(capabilities, "tools")) {
          throw new TalosError({
            code: "PLUGIN_CAPABILITY_DENIED",
            message: `Plugin ${plugin.id} is not allowed to register tools.`,
          });
        }
        registerTool(tool);
        ownedTools.add(tool.name.trim());
      },
      registerModelProvider: (provider) => {
        if (!hasCapability(capabilities, "providers")) {
          throw new TalosError({
            code: "PLUGIN_CAPABILITY_DENIED",
            message: `Plugin ${plugin.id} is not allowed to register providers.`,
          });
        }
        registerModelProvider(provider);
        ownedProviders.add(provider.id.trim());
      },
      on: (name, handler) => {
        if (!hasCapability(capabilities, "hooks")) {
          throw new TalosError({
            code: "PLUGIN_CAPABILITY_DENIED",
            message: `Plugin ${plugin.id} is not allowed to register hooks.`,
          });
        }
        plugins.addHook(normalizedPluginId, name, handler);
      },
    });
    plugins.markRegistered(normalizedPluginId);
    pluginOwnedTools.set(normalizedPluginId, ownedTools);
    pluginOwnedProviders.set(normalizedPluginId, ownedProviders);
    pluginCapabilities.set(normalizedPluginId, [...capabilities]);
    pluginApiVersions.set(normalizedPluginId, apiVersion);
    if (typeof teardown === "function") {
      pluginTeardowns.set(normalizedPluginId, teardown);
    }
    await events.emit({
      type: "plugin.registered",
      at: new Date().toISOString(),
      data: {
        pluginId: normalizedPluginId,
      },
    });
  };

  const removePlugin = async (pluginId: string): Promise<boolean> => {
    const normalizedPluginId = pluginId.trim();
    if (!normalizedPluginId) {
      return false;
    }
    const removed = plugins.remove(normalizedPluginId);
    if (!removed) {
      return false;
    }

    let teardownError: unknown = null;
    const teardown = pluginTeardowns.get(normalizedPluginId);
    if (teardown) {
      try {
        await teardown();
      } catch (error) {
        teardownError = error;
      } finally {
        pluginTeardowns.delete(normalizedPluginId);
      }
    }

    const ownedTools = pluginOwnedTools.get(normalizedPluginId);
    if (ownedTools) {
      for (const toolName of ownedTools) {
        tools.remove(toolName);
      }
      pluginOwnedTools.delete(normalizedPluginId);
    }

    const ownedProviders = pluginOwnedProviders.get(normalizedPluginId);
    if (ownedProviders) {
      for (const providerId of ownedProviders) {
        models.remove(providerId);
      }
      pluginOwnedProviders.delete(normalizedPluginId);
    }

    pluginCapabilities.delete(normalizedPluginId);
    pluginApiVersions.delete(normalizedPluginId);

    await events.emit({
      type: "plugin.unregistered",
      at: new Date().toISOString(),
      data: {
        pluginId: normalizedPluginId,
      },
    });

    if (teardownError) {
      throw new TalosError({
        code: "PLUGIN_UNLOAD_FAILED",
        message: `Plugin teardown failed: ${normalizedPluginId}`,
        cause: teardownError,
      });
    }

    return true;
  };

  const listPlugins = (): string[] => {
    return plugins.list();
  };

  const listPluginSummaries = (): PluginSummary[] => {
    return plugins.list().map((pluginId) => {
      const capabilities = pluginCapabilities.get(pluginId) ?? [];
      const tools = pluginOwnedTools.get(pluginId);
      const providers = pluginOwnedProviders.get(pluginId);
      return {
        id: pluginId,
        apiVersion: pluginApiVersions.get(pluginId) ?? TALOS_PLUGIN_API_VERSION,
        capabilities,
        toolCount: tools?.size ?? 0,
        providerCount: providers?.size ?? 0,
        hooks: plugins.getHooks(pluginId),
      };
    });
  };

  const getPluginSummary = (pluginId: string): PluginSummary | undefined => {
    const normalizedPluginId = pluginId.trim();
    if (!normalizedPluginId || !plugins.has(normalizedPluginId)) {
      return undefined;
    }
    const capabilities = pluginCapabilities.get(normalizedPluginId) ?? [];
    const tools = pluginOwnedTools.get(normalizedPluginId);
    const providers = pluginOwnedProviders.get(normalizedPluginId);
    return {
      id: normalizedPluginId,
      apiVersion: pluginApiVersions.get(normalizedPluginId) ?? TALOS_PLUGIN_API_VERSION,
      capabilities,
      toolCount: tools?.size ?? 0,
      providerCount: providers?.size ?? 0,
      hooks: plugins.getHooks(normalizedPluginId),
    };
  };

  const hasPlugin = (pluginId: string): boolean => {
    return plugins.has(pluginId);
  };

  const onEvent = (listener: RunLifecycleListener): RunLifecycleUnsubscribe => {
    return events.on(listener);
  };

  const resolveStateFilePath = (filePath?: string): string => {
    const candidate = filePath?.trim() || defaultStateFile;
    if (!candidate) {
      throw new TalosError({
        code: "CONFIG_INVALID",
        message: "State file path is not configured. Set runtime.stateFile or provide a path.",
      });
    }
    return candidate;
  };

  const saveState = async (filePath?: string): Promise<string> => {
    const target = resolveStateFilePath(filePath);
    const snapshot = {
      ...events.snapshot(),
      sessions: listSessionsSnapshot(),
    };
    return await saveStateSnapshot(target, snapshot, {
      ...(redactKeys ? { redactKeys } : {}),
    });
  };

  const loadState = async (filePath?: string): Promise<string> => {
    const target = resolveStateFilePath(filePath);
    const loaded = await loadStateSnapshot(target);
    events.replace(loaded.snapshot);
    sessions.clear();
    if (Array.isArray(loaded.snapshot.sessions)) {
      for (const session of loaded.snapshot.sessions) {
        const sessionId = session.sessionId.trim();
        if (!sessionId) {
          continue;
        }
        sessions.set(sessionId, {
          ...session,
          sessionId,
          messages: Array.isArray(session.messages) ? session.messages : [],
        });
      }
    }
    return loaded.path;
  };

  if (defaultStateFile) {
    void loadState(defaultStateFile).catch(() => {
      // Missing state on first run is expected.
    });
    let persistQueue: Promise<void> = Promise.resolve();
    onEvent(() => {
      persistQueue = persistQueue
        .then(async () => {
          await saveState(defaultStateFile);
        })
        .catch(() => {
          // Persist failures are non-fatal for runtime behavior.
        });
    });
  }

  const listEvents = (limit?: number) => {
    return events.listEvents(limit);
  };

  const queryEvents = (query?: EventQuery) => {
    return events.queryEvents(query);
  };

  const listRunEvents = (runId: string) => {
    return events.listRunEvents(runId);
  };

  const listRuns = (limit?: number): RunSummary[] => {
    return events.listRuns(limit);
  };

  const queryRuns = (query?: RunQuery): RunSummary[] => {
    return events.queryRuns(query);
  };

  const getRun = (runId: string): RunSummary | undefined => {
    return events.getRun(runId);
  };

  const getRunStats = (): RunStats => {
    return events.getRunStats();
  };

  const getDiagnostics = (options?: { recentEventsLimit?: number }): TalosDiagnostics => {
    const recentEventsLimit = options?.recentEventsLimit ?? 50;
    return {
      generatedAt: new Date().toISOString(),
      counts: {
        agents: agents.list().length,
        tools: tools.list().length,
        plugins: plugins.list().length,
        providers: models.list().length,
        activeRuns: activeRuns.size,
      },
      runStats: events.getRunStats(),
      recentEvents: events.listEvents(recentEventsLimit),
    };
  };

  const resetDiagnostics = (): DiagnosticsResetResult => {
    return events.reset();
  };

  const listActiveRuns = (): ActiveRun[] => {
    return Array.from(activeRuns.values()).map((entry) => entry.meta);
  };

  const cancelRun = (runId: string): boolean => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return false;
    }
    const active = activeRuns.get(normalizedRunId);
    if (!active) {
      return false;
    }
    active.controller.abort();
    return true;
  };

  const seedPersonaWorkspaceApi = async (
    workspaceDir: string,
    options?: Parameters<typeof seedPersonaWorkspace>[1],
  ) => {
    return await seedPersonaWorkspace(workspaceDir, options);
  };

  const loadPluginFromPathApi = async (filePath: string): Promise<void> => {
    const plugin = await loadPluginFromPath(filePath);
    await registerPlugin(plugin);
  };

  const loadPluginsFromDirectory = async (directoryPath: string): Promise<string[]> => {
    const pluginPaths = await discoverPluginEntryPaths(directoryPath);
    const loadedPluginIds: string[] = [];
    for (const pluginPath of pluginPaths) {
      const plugin = await loadPluginFromPath(pluginPath);
      try {
        await registerPlugin(plugin);
        loadedPluginIds.push(plugin.id);
      } catch (error) {
        if (error instanceof TalosError && error.code === "PLUGIN_DUPLICATE") {
          continue;
        }
        throw error;
      }
    }
    return loadedPluginIds;
  };

  const executeTool = async (input: ToolExecutionInput): Promise<ToolResult> => {
    const toolAbortController = new AbortController();
    const externalSignal = input.signal;
    let detachExternalAbort: (() => void) | undefined;
    if (externalSignal?.aborted) {
      toolAbortController.abort();
    } else if (externalSignal) {
      const onExternalAbort = () => {
        toolAbortController.abort();
      };
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      detachExternalAbort = () => {
        externalSignal.removeEventListener("abort", onExternalAbort);
      };
    }

    const args = input.args ?? {};
    const normalizedInput: ToolExecutionInput = {
      name: input.name,
      args,
      context: input.context,
      signal: toolAbortController.signal,
      ...(input.policy ? { policy: input.policy } : {}),
    };

    assertToolNotAborted(normalizedInput.signal, normalizedInput.name);

    await events.emit({
      type: "tool.started",
      at: new Date().toISOString(),
      data: {
        name: normalizedInput.name,
        agentId: normalizedInput.context.agentId,
        ...(normalizedInput.context.sessionId ? { sessionId: normalizedInput.context.sessionId } : {}),
        ...(normalizedInput.context.runId ? { runId: normalizedInput.context.runId } : {}),
      },
    });

    try {
      await plugins.runBeforeTool(normalizedInput);
      assertToolNotAborted(normalizedInput.signal, normalizedInput.name);
      assertToolAllowed(
        normalizedInput.policy
          ? {
              name: normalizedInput.name,
              agentId: normalizedInput.context.agentId,
              policy: normalizedInput.policy,
            }
          : {
              name: normalizedInput.name,
              agentId: normalizedInput.context.agentId,
            },
      );
      const result = await withTimeout(
        tools.execute(normalizedInput.name, args, normalizedInput.context),
        toolExecutionTimeoutMs,
        `Tool execution timed out after ${toolExecutionTimeoutMs}ms: ${normalizedInput.name}`,
        "TOOL_TIMEOUT",
      );
      assertToolNotAborted(normalizedInput.signal, normalizedInput.name);
      await plugins.runAfterTool({
        input: normalizedInput,
        result,
      });
      await events.emit({
        type: "tool.completed",
        at: new Date().toISOString(),
        data: {
          name: normalizedInput.name,
          agentId: normalizedInput.context.agentId,
          ...(normalizedInput.context.sessionId
            ? { sessionId: normalizedInput.context.sessionId }
            : {}),
          ...(normalizedInput.context.runId ? { runId: normalizedInput.context.runId } : {}),
        },
      });
      return result;
    } catch (error) {
      if (error instanceof TalosError && error.code === "TOOL_CANCELLED") {
        await events.emit({
          type: "tool.cancelled",
          at: new Date().toISOString(),
          data: {
            name: normalizedInput.name,
            agentId: normalizedInput.context.agentId,
            ...(normalizedInput.context.sessionId
              ? { sessionId: normalizedInput.context.sessionId }
              : {}),
            ...(normalizedInput.context.runId ? { runId: normalizedInput.context.runId } : {}),
            reason: error.message,
          },
        });
        throw error;
      }
      await events.emit({
        type: "tool.failed",
        at: new Date().toISOString(),
        data: {
          name: normalizedInput.name,
          agentId: normalizedInput.context.agentId,
          ...(normalizedInput.context.sessionId
            ? { sessionId: normalizedInput.context.sessionId }
            : {}),
          ...(normalizedInput.context.runId ? { runId: normalizedInput.context.runId } : {}),
          error: toTalosErrorLike(error),
        },
      });
      if (error instanceof TalosError) {
        throw error;
      }
      throw new TalosError({
        code: "TOOL_FAILED",
        message: `Tool execution failed: ${normalizedInput.name}`,
        cause: error,
      });
    } finally {
      detachExternalAbort?.();
    }
  };

  const run = async (input: RunInput): Promise<RunResult> => {
    const runId = randomUUID();
    const runAbortController = new AbortController();
    const externalSignal = input.signal;
    if (externalSignal?.aborted) {
      runAbortController.abort();
    } else if (externalSignal) {
      const onExternalAbort = () => {
        runAbortController.abort();
      };
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      activeRuns.set(runId, {
        meta: {
          runId,
          agentId: input.agentId,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          startedAt: new Date().toISOString(),
        },
        controller: runAbortController,
        detachExternalAbort: () => {
          externalSignal.removeEventListener("abort", onExternalAbort);
        },
      });
    }
    if (!activeRuns.has(runId)) {
      activeRuns.set(runId, {
        meta: {
          runId,
          agentId: input.agentId,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          startedAt: new Date().toISOString(),
        },
        controller: runAbortController,
      });
    }
    const signal = runAbortController.signal;
    assertRunNotAborted(signal, runId);
    await events.emit({
      type: "run.started",
      at: new Date().toISOString(),
      runId,
      data: {
        agentId: input.agentId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.workspaceDir ? { workspaceDir: input.workspaceDir } : {}),
      },
    });
    try {
      assertRunNotAborted(signal, runId);
      await plugins.runBeforeRun(input);
      assertRunNotAborted(signal, runId);
      const agent = agents.resolve(input.agentId);
      const primaryProvider = parsed.data.providers.openaiCompatible[0];
      const primaryProviderId = agent.model?.providerId ?? primaryProvider?.id;
      const primaryModelId = agent.model?.modelId ?? primaryProvider?.defaultModel;
      if (!primaryProviderId || !primaryModelId) {
        throw new TalosError({
          code: "PROVIDER_NOT_FOUND",
          message:
            "No default provider/model could be resolved. Configure providers.openaiCompatible or set agent.model.providerId/modelId.",
        });
      }

      const attempts: Array<{ providerId: string; modelId: string }> = [
        { providerId: primaryProviderId, modelId: primaryModelId },
        ...(agent.model?.fallbacks ?? []),
      ];

      const resolvedSessionKind = resolvePersonaSessionKind({
        ...(input.sessionKind ? { sessionKind: input.sessionKind } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      });
      if (input.sessionId?.trim()) {
        const sessionId = input.sessionId.trim();
        const now = new Date().toISOString();
        const existing = sessions.get(sessionId);
        const base: SessionRecord = existing
          ? {
              ...existing,
              updatedAt: now,
              agentId: input.agentId,
              kind: resolvedSessionKind,
            }
          : {
              sessionId,
              agentId: input.agentId,
              kind: resolvedSessionKind,
              createdAt: now,
              updatedAt: now,
              messages: [],
            };
        base.messages.push({
          role: "user",
          text: input.prompt,
          at: now,
        });
        sessions.set(sessionId, base);
      }
      const personaCacheKey =
        input.sessionId && input.sessionId.trim()
          ? input.sessionId.trim().toLowerCase()
          : undefined;
      let loadedPersona: PersonaSnapshot | undefined;
      if (input.workspaceDir) {
        if (personaCacheKey) {
          loadedPersona = personaSnapshotCache.get(personaCacheKey);
        }
        if (!loadedPersona) {
          loadedPersona = await loadPersonaSnapshot(input.workspaceDir, {
            sessionKind: resolvedSessionKind,
            ...(parsed.data.persona?.extraFiles
              ? { extraPatterns: parsed.data.persona.extraFiles }
              : {}),
          });
          if (personaCacheKey) {
            personaSnapshotCache.set(personaCacheKey, loadedPersona);
          }
        }
      }
      if (loadedPersona) {
        const contextMode = input.contextMode ?? parsed.data.persona?.contextMode;
        loadedPersona = {
          ...loadedPersona,
          bootstrapFiles: filterPersonaFilesForContextMode({
            files: loadedPersona.bootstrapFiles,
            ...(contextMode ? { contextMode } : {}),
            ...(input.runKind ? { runKind: input.runKind } : {}),
          }),
        };
      }
      const persona = loadedPersona
        ? sanitizePersonaSnapshot(
            await plugins.runBeforePersonaLoad(loadedPersona, {
              workspaceDir: loadedPersona.workspaceDir,
              agentId: input.agentId,
              ...(input.sessionId ? { sessionKey: input.sessionId } : {}),
              ...(input.sessionId ? { sessionId: input.sessionId } : {}),
              sessionKind: resolvedSessionKind,
              config,
            }),
          )
        : undefined;
      const systemPrompt = [
        agent.promptPrefix,
        buildPersonaSystemPrompt(persona, {
          ...(typeof parsed.data.persona?.bootstrapMaxChars === "number"
            ? { bootstrapMaxChars: parsed.data.persona.bootstrapMaxChars }
            : {}),
          ...(typeof parsed.data.persona?.bootstrapTotalMaxChars === "number"
            ? { bootstrapTotalMaxChars: parsed.data.persona.bootstrapTotalMaxChars }
            : {}),
        }),
      ]
        .filter(Boolean)
        .join("\n\n");
      const generateWithFallback = async (promptText: string): Promise<ModelResponse> => {
        let generated: ModelResponse | null = null;
        let lastError: unknown = null;
        for (const attempt of attempts) {
          assertRunNotAborted(signal, runId);
          const request = await plugins.runBeforeModel(
            systemPrompt
              ? {
                  providerId: attempt.providerId,
                  modelId: attempt.modelId,
                  prompt: promptText,
                  system: systemPrompt,
                }
              : {
                  providerId: attempt.providerId,
                  modelId: attempt.modelId,
                  prompt: promptText,
                },
          );
          await events.emit({
            type: "model.started",
            at: new Date().toISOString(),
            runId,
            data: {
              providerId: request.providerId,
              modelId: request.modelId,
            },
          });
          for (let retry = 0; retry <= retriesPerModel; retry += 1) {
            assertRunNotAborted(signal, runId);
            try {
              const response = await withTimeout(
                models.generate(request),
                requestTimeoutMs,
                `Model request timed out after ${requestTimeoutMs}ms (${request.providerId}/${request.modelId}).`,
                "MODEL_TIMEOUT",
              );
              assertRunNotAborted(signal, runId);
              generated = response;
              await plugins.runAfterModel({
                request,
                response: generated,
              });
              await events.emit({
                type: "model.completed",
                at: new Date().toISOString(),
                runId,
                data: {
                  providerId: request.providerId,
                  modelId: request.modelId,
                },
              });
              break;
            } catch (error) {
              if (error instanceof TalosError && error.code === "RUN_CANCELLED") {
                throw error;
              }
              lastError = error;
              await events.emit({
                type: "model.failed",
                at: new Date().toISOString(),
                runId,
                data: {
                  providerId: request.providerId,
                  modelId: request.modelId,
                  error: toTalosErrorLike(error),
                },
              });
              if (retry < retriesPerModel && retryDelayMs > 0) {
                await sleep(retryDelayMs);
              }
            }
            if (generated) {
              break;
            }
          }
          if (generated) {
            break;
          }
        }
        if (!generated) {
          throw new TalosError({
            code: "RUN_FAILED",
            message: "All configured model attempts failed.",
            cause: lastError ?? undefined,
            details: {
              attempts,
            },
          });
        }
        return generated;
      };

      let generated = await generateWithFallback(input.prompt);
      if (toolLoopMaxSteps > 0) {
        let toolRound = 0;
        let workingPrompt = input.prompt;
        while (toolRound < toolLoopMaxSteps) {
          const parsedToolResponse = parseToolLoopResponse(generated.text);
          if (!parsedToolResponse || parsedToolResponse.toolCalls.length === 0) {
            break;
          }
          const toolOutputs: string[] = [];
          for (const call of parsedToolResponse.toolCalls) {
            const toolResult = await executeTool({
              name: call.name,
              args: call.args,
              context: {
                agentId: input.agentId,
                ...(input.sessionId ? { sessionId: input.sessionId } : {}),
                ...(input.workspaceDir ? { workspaceDir: input.workspaceDir } : {}),
                runId,
              },
              signal,
              ...(input.tools ? { policy: input.tools } : {}),
            });
            toolOutputs.push(`- ${call.name}: ${toolResult.content}`);
          }
          if (parsedToolResponse.final) {
            generated = {
              ...generated,
              text: parsedToolResponse.final,
            };
            break;
          }
          toolRound += 1;
          workingPrompt = [
            workingPrompt,
            "",
            "Tool results:",
            ...toolOutputs,
            "",
            "Provide the final answer for the user. If you still need tools, reply with JSON only.",
          ].join("\n");
          generated = await generateWithFallback(workingPrompt);
        }
      }

      const result: RunResult = {
        runId,
        text: generated.text,
        providerId: generated.providerId,
        modelId: generated.modelId,
        ...(persona ? { persona } : {}),
      };
      if (input.sessionId?.trim()) {
        const sessionId = input.sessionId.trim();
        const existing = sessions.get(sessionId);
        if (existing) {
          const now = new Date().toISOString();
          existing.updatedAt = now;
          existing.lastRunId = runId;
          existing.messages.push({
            role: "assistant",
            text: result.text,
            at: now,
            runId,
          });
          sessions.set(sessionId, existing);
        }
      }
      await plugins.runAfterRun(result);
      await events.emit({
        type: "run.completed",
        at: new Date().toISOString(),
        runId,
        data: {
          providerId: result.providerId,
          modelId: result.modelId,
        },
      });
      return result;
    } catch (error) {
      if (error instanceof TalosError && error.code === "RUN_CANCELLED") {
        await events.emit({
          type: "run.cancelled",
          at: new Date().toISOString(),
          runId,
          data: {
            reason: error.message,
          },
        });
        throw error;
      }
      await events.emit({
        type: "run.failed",
        at: new Date().toISOString(),
        runId,
        data: {
          error: toTalosErrorLike(error),
        },
      });
      if (error instanceof TalosError) {
        throw error;
      }
      throw new TalosError({
        code: "RUN_FAILED",
        message: "Talos run failed.",
        cause: error,
      });
    } finally {
      const active = activeRuns.get(runId);
      active?.detachExternalAbort?.();
      activeRuns.delete(runId);
    }
  };

  return {
    registerAgent,
    listAgents,
    hasAgent,
    removeAgent,
    registerTool,
    registerWebTools,
    registerMediaTools,
    registerBrowserTools,
    registerCanvasTools,
    registerSessionTools,
    registerLlmTaskTool,
    listTools,
    hasTool,
    removeTool,
    registerPlugin,
    removePlugin,
    listPlugins,
    listPluginSummaries,
    getPluginSummary,
    hasPlugin,
    registerModelProvider,
    listModelProviders,
    hasModelProvider,
    removeModelProvider,
    registerAuthProfile,
    listAuthProfiles,
    hasAuthProfile,
    removeAuthProfile,
    onEvent,
    listEvents,
    queryEvents,
    listRunEvents,
    listRuns,
    queryRuns,
    getRun,
    getRunStats,
    getDiagnostics,
    resetDiagnostics,
    saveState,
    loadState,
    listActiveRuns,
    cancelRun,
    seedPersonaWorkspace: seedPersonaWorkspaceApi,
    loadPluginFromPath: loadPluginFromPathApi,
    loadPluginsFromDirectory,
    executeTool,
    run,
  };
}
