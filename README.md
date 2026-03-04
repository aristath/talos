# talos

Talos is a TypeScript library for building agent systems with:

- agent definitions and orchestration
- persona files (`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`)
- OpenAI-compatible model connectivity
- tool runtime
- plugin runtime

Model execution supports per-agent primary model configuration and ordered fallback attempts.
Model runtime supports request timeout and retry policy (`models.requestTimeoutMs`, `models.retriesPerModel`, `models.retryDelayMs`).
Model runtime supports optional tool-call loops (`models.toolLoopMaxSteps`) using JSON tool directives.
Tool execution supports config-level allow/deny policy (`tools.allow`, `tools.deny`).
Tool runtime supports `tools.executionTimeoutMs` and `executeTool(..., signal)` cancellation.
Tool runtime supports execution modes (`tools.executionMode`: `host` | `sandbox`) with sandbox constraints (`tools.sandbox`) and output limits (`tools.maxOutputBytes`).
Plugin hooks include `beforeModel` and `afterModel` for model request/response interception.
OpenAI-compatible providers can resolve credentials from `authProfiles` via `authProfileId`.
State snapshots can be persisted automatically by setting `runtime.stateFile`.
State snapshot serialization can redact sensitive fields via `security.redactKeys`.

Current core API:

- `createTalos(config)`
- `registerAgent(agent)`
- `listAgents()`, `hasAgent(agentId)`, and `removeAgent(agentId)`
- `registerTool(tool)`
- `registerExecTool(options?)` to register built-in command execution tool
- `listTools()`, `hasTool(toolName)`, and `removeTool(toolName)`
- `registerPlugin(plugin)` with capability declarations (`tools`, `providers`, `hooks`)
- plugins can declare `apiVersion` (current supported version: `1`)
- plugin SDK exports: `definePlugin`, `assertPluginCompatibility`, `TALOS_PLUGIN_API_VERSION`
- `removePlugin(pluginId)` to unload a registered plugin
- plugin `setup()` may return a teardown function executed during `removePlugin`
- `listPlugins()` and `hasPlugin(pluginId)`
- `listPluginSummaries()` and `getPluginSummary(pluginId)` for plugin metadata (api version, owned tool/provider counts, registered hooks)
- `loadPluginFromPath(filePath)` and `loadPluginsFromDirectory(directoryPath)`
- `registerModelProvider(provider)`
- `listModelProviders()`, `hasModelProvider(providerId)`, and `removeModelProvider(providerId)`
- `registerAuthProfile(profile)`, `listAuthProfiles()`, `hasAuthProfile(profileId)`, and `removeAuthProfile(profileId)`
- `onEvent(listener)` for lifecycle events (returns unsubscribe function)
- `listEvents(limit?)` and `listRunEvents(runId)` for in-memory event diagnostics
- `queryEvents({ type?, runId?, since?, until?, limit? })` for event filtering
- `listRuns(limit?)` and `getRun(runId)` for run status summaries
- `queryRuns({ status?, agentId?, since?, until?, limit? })` for filtered run queries
- `getRunStats()` for aggregate run state metrics
- `getDiagnostics({ recentEventsLimit? })` for a compact runtime snapshot
- `resetDiagnostics()` to clear in-memory event/run telemetry
- `saveState(filePath?)` and `loadState(filePath?)` for persisted run/event state snapshots
- `listActiveRuns()` and `cancelRun(runId)` for runtime run control
- `executeTool(input)` for direct tool execution
- `seedPersonaWorkspace(workspaceDir, options?)` to initialize persona files
- `run(input)`

`run(input)` returns a `runId` and lifecycle events include that same `runId` for correlation.
`run(input)` also supports cancellation via `AbortSignal` (`input.signal`).

This repository intentionally excludes channel integrations, UI apps, and CLI surfaces.

Further docs:

- `docs/architecture.md`
- `docs/plugins.md`
- `docs/security.md`
