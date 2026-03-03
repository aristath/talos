import { talosConfigSchema } from "./config/schema.js";
import { AgentRegistry } from "./agents/registry.js";
import { ModelRegistry } from "./models/registry.js";
import { createOpenAICompatibleProvider } from "./models/openai-compatible.js";
import { loadPersonaSnapshot, buildPersonaSystemPrompt } from "./persona/loader.js";
import { PluginRegistry } from "./plugins/registry.js";
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
  ModelResponse,
} from "./types.js";

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

  const hasCapability = (pluginCapabilities: PluginCapability[] | undefined, needed: PluginCapability) => {
    return pluginCapabilities?.includes(needed) ?? false;
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

  const registerTool = (tool: ToolDefinition) => {
    tools.register(tool);
  };

  const registerAgent = (agent: AgentDefinition) => {
    agents.register(agent);
  };

  const registerPlugin = async (plugin: TalosPlugin) => {
    plugins.assertNotRegistered(plugin.id);
    const capabilities = plugin.capabilities ?? ["tools", "providers", "hooks"];
    await plugin.setup({
      registerTool: (tool) => {
        if (!hasCapability(capabilities, "tools")) {
          throw new TalosError({
            code: "PLUGIN_CAPABILITY_DENIED",
            message: `Plugin ${plugin.id} is not allowed to register tools.`,
          });
        }
        registerTool(tool);
      },
      registerModelProvider: (provider) => {
        if (!hasCapability(capabilities, "providers")) {
          throw new TalosError({
            code: "PLUGIN_CAPABILITY_DENIED",
            message: `Plugin ${plugin.id} is not allowed to register providers.`,
          });
        }
        registerModelProvider(provider);
      },
      on: (name, handler) => {
        if (!hasCapability(capabilities, "hooks")) {
          throw new TalosError({
            code: "PLUGIN_CAPABILITY_DENIED",
            message: `Plugin ${plugin.id} is not allowed to register hooks.`,
          });
        }
        plugins.addHook(name, handler);
      },
    });
    plugins.markRegistered(plugin.id);
    await events.emit({
      type: "plugin.registered",
      at: new Date().toISOString(),
      data: {
        pluginId: plugin.id,
      },
    });
  };

  const onEvent = (listener: RunLifecycleListener) => {
    events.on(listener);
  };

  const run = async (input: RunInput): Promise<RunResult> => {
    await events.emit({
      type: "run.started",
      at: new Date().toISOString(),
      data: {
        agentId: input.agentId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.workspaceDir ? { workspaceDir: input.workspaceDir } : {}),
      },
    });
    try {
      await plugins.runBeforeRun(input);
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
        try {
          generated = await models.generate(
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
          break;
        } catch (error) {
          lastError = error;
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
        text: generated.text,
        providerId: generated.providerId,
        modelId: generated.modelId,
        ...(persona ? { persona } : {}),
      };
      await plugins.runAfterRun(result);
      await events.emit({
        type: "run.completed",
        at: new Date().toISOString(),
        data: {
          providerId: result.providerId,
          modelId: result.modelId,
        },
      });
      return result;
    } catch (error) {
      await events.emit({
        type: "run.failed",
        at: new Date().toISOString(),
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
    }
  };

  return {
    registerAgent,
    registerTool,
    registerPlugin,
    registerModelProvider,
    onEvent,
    run,
  };
}
