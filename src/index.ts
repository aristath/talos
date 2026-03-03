export { createTalos } from "./talos.js";
export { TalosError } from "./errors.js";
export { discoverPluginEntryPaths, loadPluginFromPath } from "./plugins/loader.js";
export { seedPersonaWorkspace } from "./persona/bootstrap.js";
export type {
  Talos,
  TalosConfig,
  RunInput,
  RunResult,
  AgentDefinition,
  ToolDefinition,
  ToolExecutionInput,
  ToolResult,
  TalosPlugin,
  TalosErrorCode,
  RunLifecycleEvent,
  RunLifecycleListener,
  PluginCapability,
} from "./types.js";
