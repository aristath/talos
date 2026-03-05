import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createOpenAICompatibleProxy, type OpenAIProxyOptions } from "./openai-compatible-proxy.js";

export type OpenAIProxyServerCorsOptions = {
  allowOrigin?: string;
  allowHeaders?: string;
  allowMethods?: string;
};

export type OpenAIProxyServerOptions = OpenAIProxyOptions & {
  cors?: OpenAIProxyServerCorsOptions;
};

export type OpenAIProxyServer = {
  server: Server;
  listen: (port?: number, host?: string) => Promise<{ port: number; host: string }>;
  close: () => Promise<void>;
};

async function readRequestBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function requestUrl(req: IncomingMessage): string {
  const host = req.headers.host || "localhost";
  const protocol = "http";
  return `${protocol}://${host}${req.url || "/"}`;
}

function toFetchHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }
    if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

async function writeFetchResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    if (!res.write(Buffer.from(chunk.value))) {
      await new Promise<void>((resolve) => res.once("drain", resolve));
    }
  }
  res.end();
}

function applyCorsHeaders(res: ServerResponse, cors?: OpenAIProxyServerCorsOptions): void {
  if (!cors) {
    return;
  }
  res.setHeader("access-control-allow-origin", cors.allowOrigin ?? "*");
  res.setHeader("access-control-allow-headers", cors.allowHeaders ?? "authorization,content-type,x-agent-id");
  res.setHeader("access-control-allow-methods", cors.allowMethods ?? "GET,POST,OPTIONS");
}

export function createOpenAICompatibleProxyServer(options: OpenAIProxyServerOptions): OpenAIProxyServer {
  const proxy = createOpenAICompatibleProxy(options);
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        applyCorsHeaders(res, options.cors);
        res.end();
        return;
      }
      const body = await readRequestBody(req);
      const requestInit: RequestInit = {
        method: req.method ?? "GET",
        headers: toFetchHeaders(req),
      };
      if (body.length > 0) {
        requestInit.body = Buffer.from(body);
      }
      const request = new Request(requestUrl(req), requestInit);
      const response = await proxy.handle(request);
      applyCorsHeaders(res, options.cors);
      await writeFetchResponse(response, res);
    } catch (error) {
      res.statusCode = 500;
      applyCorsHeaders(res, options.cors);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: {
            message: error instanceof Error ? error.message : "Proxy server failed.",
            type: "internal_error",
          },
        }),
      );
    }
  });

  return {
    server,
    listen: (port = 0, host = "127.0.0.1") =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("Unable to resolve listening address."));
            return;
          }
          resolve({
            port: address.port,
            host: address.address,
          });
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
