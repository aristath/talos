import { randomUUID } from "node:crypto";
import { talosConfigSchema } from "./config/schema.js";
import { AgentRegistry } from "./agents/registry.js";
import { ModelRegistry } from "./models/registry.js";
import { createOpenAICompatibleProvider } from "./models/openai-compatible.js";
import { loadPersonaSnapshot, buildPersonaSystemPrompt } from "./persona/loader.js";
import { seedPersonaWorkspace } from "./persona/bootstrap.js";
import { PluginRegistry } from "./plugins/registry.js";
import { discoverPluginEntryPaths, loadPluginFromPath } from "./plugins/loader.js";
import { ToolRegistry } from "./tools/registry.js";
import { TalosError, toTalosErrorLike } from "./errors.js";
import { LifecycleEventBus } from "./observability/events.js";
import type {
  AgentDefinition,
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
  ActiveRun,
  RunSummary,
  RunStats,
} from "./types.js";

const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES_PER_MODEL = 0;
const DEFAULT_RETRY_DELAY_MS = 0;

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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new TalosError({
              code: "MODEL_TIMEOUT",
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
  const pluginTeardowns = new Map<string, () => void | Promise<void>>();
  const requestTimeoutMs = parsed.data.models?.requestTimeoutMs ?? DEFAULT_MODEL_REQUEST_TIMEOUT_MS;
  const retriesPerModel = parsed.data.models?.retriesPerModel ?? DEFAULT_RETRIES_PER_MODEL;
  const retryDelayMs = parsed.data.models?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const hasCapability = (pluginCapabilities: PluginCapability[] | undefined, needed: PluginCapability) => {
    return pluginCapabilities?.includes(needed) ?? false;
  };

  const normalizeToolName = (name: string) => name.trim().toLowerCase();
  const toolAllowlist = new Set((parsed.data.tools?.allow ?? []).map(normalizeToolName));
  const toolDenylist = new Set((parsed.data.tools?.deny ?? []).map(normalizeToolName));

  const assertToolAllowed = (name: string) => {
    const normalized = normalizeToolName(name);
    if (toolDenylist.has(normalized)) {
      throw new TalosError({
        code: "TOOL_NOT_ALLOWED",
        message: `Tool is denied by configuration: ${name}`,
      });
    }
    if (toolAllowlist.size > 0 && !toolAllowlist.has(normalized)) {
      throw new TalosError({
        code: "TOOL_NOT_ALLOWED",
        message: `Tool is not in allowlist: ${name}`,
      });
    }
  };

  for (const provider of parsed.data.providers.openaiCompatible) {
    const providerConfig = {
      id: provider.id,
      baseUrl: provider.baseUrl,
      ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
      ...(provider.headers ? { headers: provider.headers } : {}),
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

  const registerTool = (tool: ToolDefinition) => {
    assertToolAllowed(tool.name);
    tools.register(tool);
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
    const capabilities = plugin.capabilities ?? ["tools", "providers", "hooks"];
    const ownedTools = new Set<string>();
    const ownedProviders = new Set<string>();
    const teardown = await plugin.setup({
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

  const hasPlugin = (pluginId: string): boolean => {
    return plugins.has(pluginId);
  };

  const onEvent = (listener: RunLifecycleListener): RunLifecycleUnsubscribe => {
    return events.on(listener);
  };

  const listEvents = (limit?: number) => {
    return events.listEvents(limit);
  };

  const listRunEvents = (runId: string) => {
    return events.listRunEvents(runId);
  };

  const listRuns = (limit?: number): RunSummary[] => {
    return events.listRuns(limit);
  };

  const getRun = (runId: string): RunSummary | undefined => {
    return events.getRun(runId);
  };

  const getRunStats = (): RunStats => {
    return events.getRunStats();
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
    const args = input.args ?? {};
    const normalizedInput: ToolExecutionInput = {
      name: input.name,
      args,
      context: input.context,
    };

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
      assertToolAllowed(normalizedInput.name);
      const result = await tools.execute(normalizedInput.name, args, normalizedInput.context);
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

      const persona = input.workspaceDir ? await loadPersonaSnapshot(input.workspaceDir) : undefined;
      const systemPrompt = [agent.promptPrefix, buildPersonaSystemPrompt(persona)]
        .filter(Boolean)
        .join("\n\n");
      let generated: ModelResponse | null = null;
      let lastError: unknown = null;
      for (const attempt of attempts) {
        assertRunNotAborted(signal, runId);
        const request = await plugins.runBeforeModel(
          systemPrompt
            ? {
                providerId: attempt.providerId,
                modelId: attempt.modelId,
                prompt: input.prompt,
                system: systemPrompt,
              }
            : {
                providerId: attempt.providerId,
                modelId: attempt.modelId,
                prompt: input.prompt,
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

      const result: RunResult = {
        runId,
        text: generated.text,
        providerId: generated.providerId,
        modelId: generated.modelId,
        ...(persona ? { persona } : {}),
      };
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
    listTools,
    hasTool,
    removeTool,
    registerPlugin,
    removePlugin,
    listPlugins,
    hasPlugin,
    registerModelProvider,
    listModelProviders,
    hasModelProvider,
    removeModelProvider,
    onEvent,
    listEvents,
    listRunEvents,
    listRuns,
    getRun,
    getRunStats,
    listActiveRuns,
    cancelRun,
    seedPersonaWorkspace: seedPersonaWorkspaceApi,
    loadPluginFromPath: loadPluginFromPathApi,
    loadPluginsFromDirectory,
    executeTool,
    run,
  };
}
