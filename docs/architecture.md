# Talos Architecture

Talos is a library-only runtime with six core planes:

1. `config`
2. `persona`
3. `agents`
4. `models`
5. `tools`
6. `plugins`

## Runtime flow

`createTalos(config)` creates and wires registries.

`run(input)` executes the orchestration pipeline:

1. Resolve agent and model strategy.
2. Compose persona/system context from workspace files.
3. Execute model call with timeout/retry/fallback policy.
4. Optionally enter tool-loop rounds when model emits JSON tool directives.
5. Emit lifecycle events and update run summaries/statistics.

## State and diagnostics

Talos keeps diagnostics in memory by default:

- lifecycle event history
- run summaries and run stats
- active run index

If `runtime.stateFile` is configured, Talos auto-loads state at startup and auto-persists updates.

## Plugin boundary

Plugins can register:

- tools
- model providers
- lifecycle hooks

Capabilities are explicitly declared and enforced at runtime. Plugins can also declare `apiVersion` and are rejected if incompatible.
