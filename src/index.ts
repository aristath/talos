export { createSoulSwitch } from "./soulSwitch.js";
export { SoulSwitchError } from "./errors.js";
export { SOULSWITCH_PLUGIN_API_VERSION, definePlugin, assertPluginCompatibility } from "./plugin-sdk.js";
export { createWebSearchTool, createWebFetchTool } from "./tools/builtins/web.js";
export { createImageTool, createPdfTool } from "./tools/builtins/media.js";
export { createBrowserTool, createCanvasTool } from "./tools/builtins/browser-ui.js";
export { createSessionTools } from "./tools/builtins/sessions.js";
export { createLlmTaskTool } from "./tools/builtins/llm-task.js";
export { createOpenAICompatibleProxy } from "./proxy/openai-compatible-proxy.js";
export { createOpenAICompatibleProxyServer } from "./proxy/server.js";
export { loadOpenAIProxyOptionsFromFile } from "./proxy/config.js";
export { loadOpenAIProxyServerOptionsFromFile } from "./proxy/config.js";
export { createOpenAICompatibleProxyFromFile, createOpenAICompatibleProxyServerFromFile } from "./proxy/bootstrap.js";
export { startOpenAICompatibleProxyServerFromFile } from "./proxy/bootstrap.js";
export type { OpenAIProxyOptions } from "./proxy/openai-compatible-proxy.js";
export type { OpenAIProxyServerOptions, OpenAIProxyServerCorsOptions } from "./proxy/server.js";
export { redactValue } from "./security/redaction.js";
export { discoverPluginEntryPaths, loadPluginFromPath } from "./plugins/loader.js";
export { seedPersonaWorkspace } from "./persona/bootstrap.js";
export type {
  SoulSwitch,
  SoulSwitchConfig,
  RunInput,
  RunResult,
  AgentDefinition,
  ToolDefinition,
  ToolExecutionInput,
  ToolResult,
  AuthProfile,
  WebSearchResultItem,
  WebSearchToolOptions,
  WebFetchToolOptions,
  MediaUnderstandToolOptions,
  BrowserToolOptions,
  CanvasToolOptions,
  SessionMessage,
  SessionRecord,
  SessionToolsCallbacks,
  SessionToolsOptions,
  LlmTaskToolOptions,
  SoulSwitchPlugin,
  SoulSwitchErrorCode,
  RunLifecycleEvent,
  RunLifecycleListener,
  RunLifecycleUnsubscribe,
  ActiveRun,
  RunSummary,
  RunStatus,
  RunQuery,
  EventQuery,
  RunStats,
  PluginSummary,
  SoulSwitchDiagnostics,
  SoulSwitchStateSnapshot,
  DiagnosticsResetResult,
  PluginCapability,
} from "./types.js";
