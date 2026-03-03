import type { PersonaFileName, PersonaSnapshot } from "./persona/types.js";
import type { PersonaBootstrapResult } from "./persona/bootstrap.js";

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
  models?: {
    requestTimeoutMs?: number;
    retriesPerModel?: number;
    retryDelayMs?: number;
  };
  tools?: {
    allow?: string[];
    deny?: string[];
    executionTimeoutMs?: number;
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
  signal?: AbortSignal;
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
  signal?: AbortSignal;
};

export type RunResult = {
  runId: string;
  text: string;
  providerId: string;
  modelId: string;
  persona?: PersonaSnapshot;
};

export type RunContext = {
  agentId: string;
  workspaceDir?: string;
  sessionId?: string;
  runId?: string;
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
  | "PLUGIN_UNLOAD_FAILED"
  | "PLUGIN_CAPABILITY_DENIED"
  | "PLUGIN_HOOK_INVALID"
  | "RUN_FAILED"
  | "RUN_CANCELLED"
  | "TOOL_FAILED"
  | "TOOL_CANCELLED"
  | "TOOL_TIMEOUT"
  | "TOOL_NOT_ALLOWED"
  | "MODEL_TIMEOUT"
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
      runId: string;
    }
  | {
      type: "run.completed";
      at: string;
      data: Pick<RunResult, "providerId" | "modelId">;
      runId: string;
    }
  | {
      type: "run.failed";
      at: string;
      data: {
        error: TalosErrorLike;
      };
      runId: string;
    }
  | {
      type: "run.cancelled";
      at: string;
      data: {
        reason: string;
      };
      runId: string;
    }
  | {
      type: "plugin.registered";
      at: string;
      data: {
        pluginId: string;
      };
    }
  | {
      type: "plugin.unregistered";
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
      runId: string;
    }
  | {
      type: "model.completed";
      at: string;
      data: {
        providerId: string;
        modelId: string;
      };
      runId: string;
    }
  | {
      type: "model.failed";
      at: string;
      data: {
        providerId: string;
        modelId: string;
        error: TalosErrorLike;
      };
      runId: string;
    }
  | {
      type: "tool.started";
      at: string;
      data: {
        name: string;
        agentId: string;
        sessionId?: string;
        runId?: string;
      };
    }
  | {
      type: "tool.completed";
      at: string;
      data: {
        name: string;
        agentId: string;
        sessionId?: string;
        runId?: string;
      };
    }
  | {
      type: "tool.failed";
      at: string;
      data: {
        name: string;
        agentId: string;
        sessionId?: string;
        runId?: string;
        error: TalosErrorLike;
      };
    }
  | {
      type: "tool.cancelled";
      at: string;
      data: {
        name: string;
        agentId: string;
        sessionId?: string;
        runId?: string;
        reason: string;
      };
    };

export type RunLifecycleListener = (event: RunLifecycleEvent) => void | Promise<void>;
export type RunLifecycleUnsubscribe = () => void;

export type ActiveRun = {
  runId: string;
  agentId: string;
  sessionId?: string;
  startedAt: string;
};

export type RunStatus = "running" | "completed" | "failed" | "cancelled";

export type RunSummary = {
  runId: string;
  agentId: string;
  sessionId?: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  providerId?: string;
  modelId?: string;
  error?: TalosErrorLike;
};

export type RunStats = {
  total: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
};

export type TalosDiagnostics = {
  generatedAt: string;
  counts: {
    agents: number;
    tools: number;
    plugins: number;
    providers: number;
    activeRuns: number;
  };
  runStats: RunStats;
  recentEvents: RunLifecycleEvent[];
};

export type TalosPluginApi = {
  registerTool: (tool: ToolDefinition) => void;
  registerModelProvider: (provider: ModelProviderAdapter) => void;
  on: <K extends keyof PluginHooks>(hook: K, handler: PluginHooks[K]) => void;
};

export type TalosPlugin = {
  id: string;
  capabilities?: PluginCapability[];
  setup: (
    api: TalosPluginApi,
  ) =>
    | void
    | (() => void | Promise<void>)
    | Promise<void | (() => void | Promise<void>)>;
};

export type Talos = {
  registerAgent: (agent: AgentDefinition) => void;
  listAgents: () => AgentDefinition[];
  hasAgent: (agentId: string) => boolean;
  removeAgent: (agentId: string) => boolean;
  registerTool: (tool: ToolDefinition) => void;
  listTools: () => ToolDefinition[];
  hasTool: (toolName: string) => boolean;
  removeTool: (toolName: string) => boolean;
  registerPlugin: (plugin: TalosPlugin) => Promise<void>;
  removePlugin: (pluginId: string) => Promise<boolean>;
  listPlugins: () => string[];
  hasPlugin: (pluginId: string) => boolean;
  registerModelProvider: (provider: ModelProviderAdapter) => void;
  listModelProviders: () => ModelProviderAdapter[];
  hasModelProvider: (providerId: string) => boolean;
  removeModelProvider: (providerId: string) => boolean;
  onEvent: (listener: RunLifecycleListener) => RunLifecycleUnsubscribe;
  listEvents: (limit?: number) => RunLifecycleEvent[];
  listRunEvents: (runId: string) => RunLifecycleEvent[];
  listRuns: (limit?: number) => RunSummary[];
  getRun: (runId: string) => RunSummary | undefined;
  getRunStats: () => RunStats;
  getDiagnostics: (options?: { recentEventsLimit?: number }) => TalosDiagnostics;
  listActiveRuns: () => ActiveRun[];
  cancelRun: (runId: string) => boolean;
  seedPersonaWorkspace: (
    workspaceDir: string,
    options?: {
      overwrite?: boolean;
      templates?: Partial<Record<PersonaFileName, string>>;
    },
  ) => Promise<PersonaBootstrapResult>;
  loadPluginFromPath: (filePath: string) => Promise<void>;
  loadPluginsFromDirectory: (directoryPath: string) => Promise<string[]>;
  executeTool: (input: ToolExecutionInput) => Promise<ToolResult>;
  run: (input: RunInput) => Promise<RunResult>;
};
