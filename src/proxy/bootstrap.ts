import { loadOpenAIProxyOptionsFromFile, loadOpenAIProxyServerOptionsFromFile } from "./config.js";
import { createOpenAICompatibleProxy } from "./openai-compatible-proxy.js";
import { createOpenAICompatibleProxyServer, type OpenAIProxyServer } from "./server.js";

export async function createOpenAICompatibleProxyFromFile(params: {
  workspaceDir: string;
  configPath?: string;
}): Promise<{ handle: (request: Request) => Promise<Response> }> {
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
