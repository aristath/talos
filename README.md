# talos

Talos is a TypeScript library for building agent systems with:

- agent definitions and orchestration
- persona/bootstrap files (`AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md`)
- OpenAI-compatible model connectivity
- tool runtime
- plugin runtime

Model execution supports per-agent primary model configuration and ordered fallback attempts.
Model runtime supports request timeout and retry policy (`models.requestTimeoutMs`, `models.retriesPerModel`, `models.retryDelayMs`).
Model runtime supports optional tool-call loops (`models.toolLoopMaxSteps`) using JSON tool directives.
Tool execution supports config-level allow/deny policy (`tools.allow`, `tools.deny`).
Tool runtime supports `tools.executionTimeoutMs` and `executeTool(..., signal)` cancellation.
Plugin hooks include `beforePersonaLoad`, `beforeModel`, and `afterModel` for persona/model interception.
OpenAI-compatible providers can resolve credentials from `authProfiles` via `authProfileId`.
State snapshots can be persisted automatically by setting `runtime.stateFile`.
State snapshot serialization can redact sensitive fields via `security.redactKeys`.

Current core API:

- `createTalos(config)`
- `registerAgent(agent)`
- `listAgents()`, `hasAgent(agentId)`, and `removeAgent(agentId)`
- `registerTool(tool)`
- `registerWebTools({ search, fetch? })` to register `web_search` and `web_fetch`
- `registerMediaTools({ image, pdf })` to register media understanding tools
- `registerBrowserTools(options)` to register `browser` UI automation tool
- `registerCanvasTools(options)` to register `canvas` UI automation tool
- `registerSessionTools()` to register session orchestration tools
- `registerLlmTaskTool(options?)` to register JSON-only `llm_task`
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
- `createOpenAICompatibleProxy(options)` for Fetch-compatible OpenAI proxy handling
- `createOpenAICompatibleProxyServer(options)` for Node HTTP server adapter
- `loadOpenAIProxyOptionsFromFile({ workspaceDir, configPath? })` to load proxy options from JSON
- `loadOpenAIProxyServerOptionsFromFile({ workspaceDir, configPath? })` to load server+proxy options from JSON
- `createOpenAICompatibleProxyFromFile({ workspaceDir, configPath? })` to bootstrap proxy directly from JSON
- `createOpenAICompatibleProxyServerFromFile({ workspaceDir, configPath? })` to bootstrap server directly from JSON

Both bootstrap helpers support `verifyReady: true` to fail fast when the default agent profile cannot be loaded.

`run(input)` returns a `runId` and lifecycle events include that same `runId` for correlation.
`run(input)` also supports cancellation via `AbortSignal` (`input.signal`).
Persona loading follows session semantics: main sessions load full persona context, while subagent/cron sessions load a minimal allowlist.
Persona context can also include extra bootstrap files via `persona.extraFiles` and prompt budgets via
`persona.bootstrapMaxChars` / `persona.bootstrapTotalMaxChars`.
Persona context mode supports OpenClaw-style lightweight runs (`contextMode: "lightweight"` + `runKind`).

This repository intentionally excludes channel integrations, UI apps, and CLI surfaces.

## OpenAI-Compatible Persona Proxy

Talos can run as a middleware/proxy in front of OpenAI-compatible providers.

- Endpoints: `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/completions`, `POST /v1/embeddings`, `GET /v1/models`, `GET /v1/models/:id`
- Agent persona files are loaded from `agents/<agentId>/`.
- Required per-agent file: `SOUL.md`
- Optional per-agent files: `STYLE.md`, `RULES.md`
- Optional per-agent config: `agent.json` for upstream routing/model/auth headers

Minimal `agent.json` example:

```json
{
  "upstream": {
    "providerId": "openrouter",
    "baseURL": "https://openrouter.ai/api/v1",
    "auth": {
      "type": "static",
      "apiKey": "sk-hardcoded-key"
    },
    "headers": {
      "HTTP-Referer": "https://agency.example",
      "X-Title": "Agency App"
    }
  },
  "model": {
    "default": "openai/gpt-4.1",
    "fallbacks": ["anthropic/claude-3-7-sonnet"]
  }
}
```

When an incoming request omits `model`, the proxy uses the agent `model.default` and will retry with `model.fallbacks` on upstream `5xx` responses.

Agent selection supports:

- `X-Agent-Id` request header
- `model: "agent:<agentId>"` alias

When `inboundAuth` is configured, bearer tokens are mapped to allowed agent ids and access is enforced.
Inbound auth accepts `Authorization: Bearer <token>`, `x-api-key`, or `api-key` headers.
Proxy responses include `x-request-id`, `x-talos-agent-id`, and `x-talos-model` headers for traceability.
The proxy exposes `ready()` and `reload(agentId?)` methods for operational checks and cache refresh.

`createOpenAICompatibleProxyServer` supports optional CORS handling (`cors.allowOrigin`, `cors.allowHeaders`, `cors.allowMethods`) and responds to `OPTIONS` preflight requests.
It also exposes `GET /healthz` for liveness/uptime checks (including active/concurrency counters).
It exposes `GET /readyz` for readiness checks against the configured default agent persona.
It exposes `GET /metricsz` for request/response counters and health metrics.
If `adminToken` is configured, `POST /reloadz` is enabled for authenticated cache refresh (`x-admin-token` or Bearer auth).
You can set `maxRequestBytes` to cap inbound body size (default: 2MB).
You can set `maxConcurrentRequests` to cap in-flight requests (default: 200).

You can keep inbound auth keys hardcoded in `proxy.json` and load them with `loadOpenAIProxyOptionsFromFile`.

Further docs:

- `docs/architecture.md`
- `docs/plugins.md`
- `docs/security.md`
- `docs/migration.md`
- `docs/support-policy.md`
