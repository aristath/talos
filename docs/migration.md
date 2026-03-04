# Migration Notes

This repository is a focused extraction of core runtime concerns from the larger OpenClaw codebase.

## Included in Talos

- agents and orchestration
- persona bootstrapping and loading (`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`)
- OpenAI-compatible model providers
- plugin runtime and plugin SDK helpers

## Not included

- channel integrations
- gateway/server surfaces
- CLI command layer
- web/mobile/desktop app surfaces

## Plugin migration guidance

When migrating an existing plugin:

1. Convert plugin export to `definePlugin(...)`.
2. Declare capabilities explicitly.
3. Remove channel/gateway/CLI dependencies.
4. Verify API compatibility with `assertPluginCompatibility(...)`.

## Operational migration guidance

- Move long-lived diagnostics persistence to `runtime.stateFile`.
- Configure `security.redactKeys` before enabling state persistence in production.
