# talos

Talos is a TypeScript library for building agent systems with:

- agent definitions and orchestration
- persona files (`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`)
- OpenAI-compatible model connectivity
- tool runtime
- plugin runtime

Current core API:

- `createTalos(config)`
- `registerAgent(agent)`
- `registerTool(tool)`
- `registerPlugin(plugin)` with capability declarations (`tools`, `providers`, `hooks`)
- `registerModelProvider(provider)`
- `onEvent(listener)` for lifecycle events
- `run(input)`

This repository intentionally excludes channel integrations, UI apps, and CLI surfaces.
