export { createTalos } from "./talos.js";
export { TalosError } from "./errors.js";
export { TALOS_PLUGIN_API_VERSION, definePlugin, assertPluginCompatibility } from "./plugin-sdk.js";
export { redactValue } from "./security/redaction.js";
export { discoverPluginEntryPaths, loadPluginFromPath } from "./plugins/loader.js";
export { seedPersonaWorkspace } from "./persona/bootstrap.js";
export type {
  Talos,
  TalosConfig,
  RunInput,
  RunResult,
  AgentDefinition,
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
