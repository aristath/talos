import { loadOpenAIProxyOptionsFromFile, loadOpenAIProxyServerOptionsFromFile } from "./config.js";
import { createOpenAICompatibleProxy } from "./openai-compatible-proxy.js";
import { createOpenAICompatibleProxyServer, type OpenAIProxyServer } from "./server.js";

export async function createOpenAICompatibleProxyFromFile(params: {
  workspaceDir: string;
  configPath?: string;
}): Promise<{
  handle: (request: Request) => Promise<Response>;
  ready: () => Promise<{ ok: boolean; agentId: string; error?: string }>;
  reload: (agentId?: string) => Promise<{ ok: boolean; cleared: number; agentId?: string }>;
}> {
  const options = await loadOpenAIProxyOptionsFromFile(params);
  return createOpenAICompatibleProxy(options);
}

export async function createOpenAICompatibleProxyServerFromFile(params: {
  workspaceDir: string;
  configPath?: string;
}): Promise<OpenAIProxyServer> {
  const options = await loadOpenAIProxyServerOptionsFromFile(params);
  return createOpenAICompatibleProxyServer(options);
}
