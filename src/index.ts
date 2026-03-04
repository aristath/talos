export { createTalos } from "./talos.js";
export { TalosError } from "./errors.js";
export { createExecTool } from "./tools/builtins/exec.js";
export { discoverPluginEntryPaths, loadPluginFromPath } from "./plugins/loader.js";
export { seedPersonaWorkspace } from "./persona/bootstrap.js";
export type {
  Talos,
  TalosConfig,
  RunInput,
  RunResult,
  AgentDefinition,
  ToolDefinition,
  ExecToolOptions,
  ToolExecutionInput,
  ToolResult,
  AuthProfile,
  TalosPlugin,
  TalosErrorCode,
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
  TalosDiagnostics,
  TalosStateSnapshot,
  DiagnosticsResetResult,
  PluginCapability,
} from "./types.js";
