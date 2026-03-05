# talos

Talos is a TypeScript runtime for persona-driven agents, with a production-focused OpenAI-compatible proxy layer.

In practice, this project is used in two ways:

- **Agent runtime library**: build and run agents with tools, plugins, model providers, and lifecycle hooks.
- **OpenAI-compatible persona proxy**: expose `/v1/*` OpenAI-style endpoints that inject agent persona and forward to upstream providers.

This repository intentionally excludes channel integrations, UI apps, and CLI surfaces.

## What This Project Is

Talos is not an orchestration SaaS. It is a local/library runtime that gives you:

- Persona file loading from workspace folders (`agents/<agentId>/...`)
- Configurable model/provider execution with retries and timeouts
- Tool runtime (web/media/browser/session/task tools)
- Plugin system with lifecycle hooks
- OpenAI-compatible middleware/proxy for existing agent clients

The proxy mode is designed for compatibility with clients that already speak OpenAI APIs and need persona routing + policy injection in front of upstream providers.

## How The Proxy Works

For each inbound request, Talos proxy does the following:

1. Resolve the target agent (`X-Agent-Id`, `model: "agent:<id>"`, or token mapping default).
2. Load and cache agent persona files from `agents/<agentId>/`:
   - required: `SOUL.md`
   - optional: `STYLE.md`, `RULES.md`
3. Build the persona prompt (optional global `platformPrompt` + agent files).
4. Resolve upstream/model/auth from `agents/<agentId>/agent.json`.
5. Transform request payload for endpoint type (`chat/completions`, `responses`, etc.) and inject persona.
6. Forward to upstream OpenAI-compatible endpoint.
7. On upstream `5xx`, try configured model fallbacks (if present).
8. Return upstream payload with Talos trace headers.

Talos keeps a profile cache and exposes reload APIs to invalidate all or single-agent cache entries.

## Supported OpenAI-Compatible Endpoints

- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/completions`
- `POST /v1/embeddings`
- `GET/HEAD /v1/models`
- `GET/HEAD /v1/models/:id`

Operational endpoints (server adapter):

- `GET/HEAD /healthz`
- `GET/HEAD /readyz`
- `GET/HEAD /metricsz`
- `POST /metricsz/reset` (when `adminToken` is set)
- `GET/POST /reloadz` (when `adminToken` is set)
- `GET /reloadz?agentId=<id>` reloads one cached agent

Operational responses include `cache-control: no-store`.

## Workspace Layout

Typical proxy workspace:

```text
workspace/
  proxy.json
  agents/
    designer/
      SOUL.md
      STYLE.md        # optional
      RULES.md        # optional
      agent.json
```

### Example `agents/designer/agent.json`

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
  },
  "limits": {
    "timeoutMs": 30000
  }
}
```

### Example `proxy.json`

```json
{
  "defaultAgentId": "designer",
  "platformPrompt": "Global platform policy",
  "allowModelAlias": true,
  "cacheTtlMs": 60000,
  "upstreamTimeoutMs": 45000,
  "maxRequestBytes": 2097152,
  "maxConcurrentRequests": 200,
  "adminToken": "admin-secret",
  "cors": {
    "allowOrigin": "*",
    "allowHeaders": "authorization,content-type,x-agent-id",
    "allowMethods": "GET,POST,OPTIONS"
  },
  "inboundAuth": [
    {
      "token": "client-key",
      "defaultAgentId": "designer",
      "allowedAgentIds": ["designer"]
    }
  ]
}
```

## How To Use It

## 1) Install

```bash
pnpm install
```

## 2) Start a proxy server from config file

```ts
import { startOpenAICompatibleProxyServerFromFile } from "talos";

const started = await startOpenAICompatibleProxyServerFromFile({
  workspaceDir: "/absolute/path/to/workspace",
  verifyReady: true
});

console.log(started.url);
```

`startOpenAICompatibleProxyServerFromFile(...)` returns:

- `server`: close/listen control
- `address`: `{ host, port }`
- `url`: ready-to-use base URL

## 3) Call it like OpenAI

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H 'authorization: Bearer client-key' \
  -H 'content-type: application/json' \
  -d '{
    "model": "agent:designer",
    "messages": [{"role": "user", "content": "Design a modern hero section."}]
  }'
```

Agent selection options:

- `X-Agent-Id: <id>` header
- `model: "agent:<id>"` alias (disable with `allowModelAlias: false`)
- inbound token default agent mapping (`inboundAuth`)

## 4) Observe and operate

- Liveness: `GET /healthz`
- Readiness: `GET /readyz`
- Metrics: `GET /metricsz`
- Reload cache: `GET /reloadz` or `GET /reloadz?agentId=<id>` (requires `adminToken`)

## Trace Headers Returned By Proxy

- `x-request-id`
- `x-talos-agent-id`
- `x-talos-model`
- `x-talos-model-attempt` (when fallbacks are active)
- `x-talos-model-candidates` (when fallbacks are active)
- `x-talos-model-fallback` (when fallback was used)

## Library API (Non-Proxy)

Core runtime entry points include:

- `createTalos(config)`
- `registerAgent(...)`, `registerTool(...)`, `registerPlugin(...)`, `registerModelProvider(...)`
- `run(input)`
- diagnostics/run/event/query/state APIs
- `seedPersonaWorkspace(workspaceDir, options?)`

Proxy-related exports:

- `createOpenAICompatibleProxy(options)`
- `createOpenAICompatibleProxyServer(options)`
- `loadOpenAIProxyOptionsFromFile(...)`
- `loadOpenAIProxyServerOptionsFromFile(...)`
- `createOpenAICompatibleProxyFromFile(...)`
- `createOpenAICompatibleProxyServerFromFile(...)`
- `startOpenAICompatibleProxyServerFromFile(...)`

## Testing

Default checks:

- `pnpm check`
- `pnpm test`

Live E2E (real upstream credentials, opt-in):

1. Copy `.env.e2e.example` to `.env.e2e.local`
2. Fill `TALOS_E2E_BASE_URL`, `TALOS_E2E_API_KEY`, and `TALOS_E2E_MODEL`
3. Run `pnpm test:e2e:live`

Live suite file: `src/proxy/live.e2e.test.ts`.

## Production Checklist

- **Auth**: configure `inboundAuth` for client access control and set `adminToken` for `/reloadz` and `/metricsz/reset`.
- **Upstream creds**: keep upstream keys in per-agent `agent.json` and restrict file access at the OS/repo level.
- **Timeouts**: set `upstreamTimeoutMs` and per-agent `limits.timeoutMs` to prevent hung upstream requests.
- **Concurrency and body limits**: tune `maxConcurrentRequests` and `maxRequestBytes` for your workload profile.
- **Fallback policy**: define `model.fallbacks` only where needed and monitor fallback rates via response headers.
- **Readiness gating**: start with `verifyReady: true` so deployments fail fast on broken default agent config.
- **Cache operations**: use `/reloadz?agentId=<id>` for targeted refreshes after persona/config updates.
- **Observability**: scrape `/metricsz`, collect `x-request-id` and Talos trace headers in logs, and alert on 5xx/401 spikes.
- **CORS**: set explicit `cors.allowOrigin`, `cors.allowHeaders`, and `cors.allowMethods` in internet-facing deployments.

## Additional Docs

- `docs/architecture.md`
- `docs/plugins.md`
- `docs/security.md`
- `docs/migration.md`
- `docs/support-policy.md`
