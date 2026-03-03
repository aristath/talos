import type { PersonaSnapshot } from "./persona/types.js";

export type TalosConfig = {
  providers: {
    openaiCompatible: {
      id: string;
      baseUrl: string;
      apiKey?: string;
      headers?: Record<string, string>;
      defaultModel: string;
    }[];
  };
  tools?: {
    allow?: string[];
    deny?: string[];
  };
};

export type AgentDefinition = {
  id: string;
  name?: string;
  model?: {
    providerId?: string;
    modelId?: string;
    fallbacks?: Array<{ providerId: string; modelId: string }>;
  };
  promptPrefix?: string;
};

export type ToolCall = {
  name: string;
  args: Record<string, unknown>;
};

export type ToolResult = {
  content: string;
  data?: unknown;
};

export type ToolExecutionInput = {
  name: string;
  args?: Record<string, unknown>;
  context: RunContext;
};

export type ToolDefinition = {
  name: string;
  description: string;
  run: (args: Record<string, unknown>, ctx: RunContext) => Promise<ToolResult>;
};

export type RunInput = {
  agentId: string;
  prompt: string;
  workspaceDir?: string;
  sessionId?: string;
};

export type RunResult = {
  text: string;
  providerId: string;
  modelId: string;
  persona?: PersonaSnapshot;
};

export type RunContext = {
  agentId: string;
  workspaceDir?: string;
  sessionId?: string;
};

export type ModelRequest = {
  providerId: string;
  modelId: string;
  system?: string;
  prompt: string;
};

export type ModelResponse = {
  text: string;
  providerId: string;
  modelId: string;
};

export type ModelProviderAdapter = {
  id: string;
  generate: (request: ModelRequest) => Promise<ModelResponse>;
};

export type TalosErrorCode =
  | "CONFIG_INVALID"
  | "AGENT_INVALID"
  | "AGENT_NOT_FOUND"
  | "PROVIDER_INVALID"
  | "PROVIDER_NOT_FOUND"
  | "PLUGIN_INVALID"
  | "PLUGIN_DUPLICATE"
  | "PLUGIN_LOAD_FAILED"
  | "PLUGIN_CAPABILITY_DENIED"
  | "PLUGIN_HOOK_INVALID"
  | "RUN_FAILED"
  | "TOOL_FAILED"
  | "TOOL_NOT_ALLOWED"
  | "PERSONA_INVALID_WORKSPACE"
  | "PERSONA_FILE_UNSAFE";

export type TalosErrorLike = {
  name: string;
  message: string;
  code?: string;
};

export type TalosErrorDetails = {
  [key: string]: unknown;
};

export type PluginCapability = "tools" | "providers" | "hooks";

export type PluginHooks = {
  beforeRun: (input: RunInput) => Promise<void> | void;
  afterRun: (result: RunResult) => Promise<void> | void;
  beforeModel: (request: ModelRequest) => Promise<ModelRequest | void> | ModelRequest | void;
  afterModel: (params: {
    request: ModelRequest;
    response: ModelResponse;
  }) => Promise<void> | void;
  beforeTool: (input: ToolExecutionInput) => Promise<void> | void;
  afterTool: (params: {
    input: ToolExecutionInput;
    result: ToolResult;
  }) => Promise<void> | void;
};

export type RunLifecycleEvent =
  | {
      type: "run.started";
      at: string;
      data: Pick<RunInput, "agentId" | "sessionId" | "workspaceDir">;
    }
  | {
      type: "run.completed";
      at: string;
      data: Pick<RunResult, "providerId" | "modelId">;
    }
  | {
      type: "run.failed";
      at: string;
      data: {
        error: TalosErrorLike;
      };
    }
  | {
      type: "plugin.registered";
      at: string;
      data: {
        pluginId: string;
      };
    }
  | {
      type: "model.started";
      at: string;
      data: {
        providerId: string;
        modelId: string;
      };
    }
  | {
      type: "model.completed";
      at: string;
      data: {
        providerId: string;
        modelId: string;
      };
    }
  | {
      type: "model.failed";
      at: string;
      data: {
        providerId: string;
        modelId: string;
        error: TalosErrorLike;
      };
    }
  | {
      type: "tool.started";
      at: string;
      data: {
        name: string;
        agentId: string;
        sessionId?: string;
      };
    }
  | {
      type: "tool.completed";
      at: string;
      data: {
        name: string;
        agentId: string;
        sessionId?: string;
      };
    }
  | {
      type: "tool.failed";
      at: string;
      data: {
        name: string;
        agentId: string;
        sessionId?: string;
        error: TalosErrorLike;
      };
    };

export type RunLifecycleListener = (event: RunLifecycleEvent) => void | Promise<void>;

export type TalosPluginApi = {
  registerTool: (tool: ToolDefinition) => void;
  registerModelProvider: (provider: ModelProviderAdapter) => void;
  on: <K extends keyof PluginHooks>(hook: K, handler: PluginHooks[K]) => void;
};

export type TalosPlugin = {
  id: string;
  capabilities?: PluginCapability[];
  setup: (api: TalosPluginApi) => void | Promise<void>;
};

export type Talos = {
  registerAgent: (agent: AgentDefinition) => void;
  registerTool: (tool: ToolDefinition) => void;
  registerPlugin: (plugin: TalosPlugin) => Promise<void>;
  registerModelProvider: (provider: ModelProviderAdapter) => void;
  onEvent: (listener: RunLifecycleListener) => void;
  loadPluginFromPath: (filePath: string) => Promise<void>;
  loadPluginsFromDirectory: (directoryPath: string) => Promise<string[]>;
  executeTool: (input: ToolExecutionInput) => Promise<ToolResult>;
  run: (input: RunInput) => Promise<RunResult>;
};
