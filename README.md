# talos

Talos is a TypeScript library for building agent systems with:

- agent definitions and orchestration
- persona files (`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`)
- OpenAI-compatible model connectivity
- tool runtime
- plugin runtime

Model execution supports per-agent primary model configuration and ordered fallback attempts.
Model runtime supports request timeout and retry policy (`models.requestTimeoutMs`, `models.retriesPerModel`, `models.retryDelayMs`).
Tool execution supports config-level allow/deny policy (`tools.allow`, `tools.deny`).
Plugin hooks include `beforeModel` and `afterModel` for model request/response interception.

Current core API:

- `createTalos(config)`
- `registerAgent(agent)`
- `listAgents()`, `hasAgent(agentId)`, and `removeAgent(agentId)`
- `registerTool(tool)`
- `listTools()`, `hasTool(toolName)`, and `removeTool(toolName)`
- `registerPlugin(plugin)` with capability declarations (`tools`, `providers`, `hooks`)
- `listPlugins()` and `hasPlugin(pluginId)`
- `loadPluginFromPath(filePath)` and `loadPluginsFromDirectory(directoryPath)`
- `registerModelProvider(provider)`
- `listModelProviders()`, `hasModelProvider(providerId)`, and `removeModelProvider(providerId)`
- `onEvent(listener)` for lifecycle events
- `listEvents(limit?)` and `listRunEvents(runId)` for in-memory event diagnostics
- `listActiveRuns()` and `cancelRun(runId)` for runtime run control
- `executeTool(input)` for direct tool execution
- `seedPersonaWorkspace(workspaceDir, options?)` to initialize persona files
- `run(input)`

`run(input)` returns a `runId` and lifecycle events include that same `runId` for correlation.
`run(input)` also supports cancellation via `AbortSignal` (`input.signal`).

This repository intentionally excludes channel integrations, UI apps, and CLI surfaces.
