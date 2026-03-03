import { talosConfigSchema } from "./config/schema.js";
import { AgentRegistry } from "./agents/registry.js";
import { ModelRegistry } from "./models/registry.js";
import { createOpenAICompatibleProvider } from "./models/openai-compatible.js";
import { loadPersonaSnapshot, buildPersonaSystemPrompt } from "./persona/loader.js";
import { PluginRegistry } from "./plugins/registry.js";
import { ToolRegistry } from "./tools/registry.js";
import type {
  AgentDefinition,
  ModelProviderAdapter,
  RunInput,
  RunResult,
  Talos,
  TalosConfig,
  TalosPlugin,
  ToolDefinition,
} from "./types.js";

export function createTalos(config: TalosConfig): Talos {
  const parsed = talosConfigSchema.parse(config);
  const agents = new AgentRegistry();
  const models = new ModelRegistry();
  const tools = new ToolRegistry();
  const plugins = new PluginRegistry();

  for (const provider of parsed.providers.openaiCompatible) {
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
    await plugin.setup({
      registerTool,
      registerModelProvider,
      on: (name, handler) => {
        plugins.addHook(name, handler);
      },
    });
    plugins.markRegistered(plugin.id);
  };

  const run = async (input: RunInput): Promise<RunResult> => {
    await plugins.runBeforeRun(input);
    const agent = agents.resolve(input.agentId);
    const primaryProvider = parsed.providers.openaiCompatible[0];
    if (!primaryProvider) {
      throw new Error("No OpenAI-compatible providers are configured.");
    }
    const providerId = agent.model?.providerId ?? primaryProvider.id;
    const modelId = agent.model?.modelId ?? primaryProvider.defaultModel;
    const persona = input.workspaceDir ? await loadPersonaSnapshot(input.workspaceDir) : undefined;
    const systemPrompt = [agent.promptPrefix, buildPersonaSystemPrompt(persona)]
      .filter(Boolean)
      .join("\n\n");
    const generated = await models.generate(
      systemPrompt
        ? {
            providerId,
            modelId,
            prompt: input.prompt,
            system: systemPrompt,
          }
        : {
            providerId,
            modelId,
            prompt: input.prompt,
          },
    );

    const result: RunResult = {
      text: generated.text,
      providerId: generated.providerId,
      modelId: generated.modelId,
      ...(persona ? { persona } : {}),
    };
    await plugins.runAfterRun(result);
    return result;
  };

  return {
    registerAgent,
    registerTool,
    registerPlugin,
    registerModelProvider,
    run,
  };
}
