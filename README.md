# talos

Talos is a TypeScript library for building agent systems with:

- agent definitions and orchestration
- persona files (`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`)
- OpenAI-compatible model connectivity
- tool runtime
- plugin runtime

Model execution supports per-agent primary model configuration and ordered fallback attempts.
Tool execution supports config-level allow/deny policy (`tools.allow`, `tools.deny`).
Plugin hooks include `beforeModel` and `afterModel` for model request/response interception.

Current core API:

- `createTalos(config)`
- `registerAgent(agent)`
- `registerTool(tool)`
- `registerPlugin(plugin)` with capability declarations (`tools`, `providers`, `hooks`)
- `loadPluginFromPath(filePath)` and `loadPluginsFromDirectory(directoryPath)`
- `registerModelProvider(provider)`
- `onEvent(listener)` for lifecycle events
- `executeTool(input)` for direct tool execution
- `run(input)`

This repository intentionally excludes channel integrations, UI apps, and CLI surfaces.
