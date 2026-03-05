import { loadOpenAIProxyOptionsFromFile, loadOpenAIProxyServerOptionsFromFile } from "./config.js";
import { createOpenAICompatibleProxy } from "./openai-compatible-proxy.js";
import { createOpenAICompatibleProxyServer, type OpenAIProxyServer } from "./server.js";
import { TalosError } from "../errors.js";

export async function createOpenAICompatibleProxyFromFile(params: {
  workspaceDir: string;
  configPath?: string;
  verifyReady?: boolean;
}): Promise<{
  handle: (request: Request) => Promise<Response>;
  ready: () => Promise<{ ok: boolean; agentId: string; error?: string }>;
  reload: (agentId?: string) => Promise<{ ok: boolean; cleared: number; agentId?: string }>;
}> {
  const options = await loadOpenAIProxyOptionsFromFile(params);
  const proxy = createOpenAICompatibleProxy(options);
  if (params.verifyReady) {
    const readiness = await proxy.ready();
    if (!readiness.ok) {
      throw new TalosError({
        code: "CONFIG_INVALID",
        message: readiness.error ?? `Proxy readiness failed for agent: ${readiness.agentId}`,
      });
    }
  }
  return proxy;
}

export async function createOpenAICompatibleProxyServerFromFile(params: {
  workspaceDir: string;
  configPath?: string;
  verifyReady?: boolean;
}): Promise<OpenAIProxyServer> {
  const options = await loadOpenAIProxyServerOptionsFromFile(params);
  if (params.verifyReady) {
    const readinessProxy = createOpenAICompatibleProxy(options);
    const readiness = await readinessProxy.ready();
    if (!readiness.ok) {
      throw new TalosError({
        code: "CONFIG_INVALID",
        message: readiness.error ?? `Proxy readiness failed for agent: ${readiness.agentId}`,
      });
    }
  }
  return createOpenAICompatibleProxyServer(options);
}
