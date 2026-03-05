import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOpenAIProxyOptionsFromFile, loadOpenAIProxyServerOptionsFromFile } from "./config.js";

describe("loadOpenAIProxyOptionsFromFile", () => {
  it("loads proxy options and inbound auth map from JSON", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-config-"));
    await fs.writeFile(
      path.join(workspaceDir, "proxy.json"),
      JSON.stringify(
        {
          defaultAgentId: "designer",
          upstreamTimeoutMs: 30000,
          inboundAuth: [
            {
              token: "client-key",
              defaultAgentId: "designer",
              allowedAgentIds: ["designer", "seo"],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const options = await loadOpenAIProxyOptionsFromFile({ workspaceDir });
    expect(options.defaultAgentId).toBe("designer");
    expect(options.upstreamTimeoutMs).toBe(30000);
    expect(options.inboundAuth?.["client-key"]?.defaultAgentId).toBe("designer");
    expect(options.inboundAuth?.["client-key"]?.allowedAgentIds).toEqual(["designer", "seo"]);
  });

  it("loads server options including CORS and maxRequestBytes", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-config-"));
    await fs.writeFile(
      path.join(workspaceDir, "proxy.json"),
      JSON.stringify(
        {
          defaultAgentId: "designer",
          maxRequestBytes: 4096,
          maxConcurrentRequests: 50,
          cors: {
            allowOrigin: "*",
            allowMethods: "GET,POST,OPTIONS",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const options = await loadOpenAIProxyServerOptionsFromFile({ workspaceDir });
    expect(options.defaultAgentId).toBe("designer");
    expect(options.maxRequestBytes).toBe(4096);
    expect(options.maxConcurrentRequests).toBe(50);
    expect(options.cors?.allowOrigin).toBe("*");
    expect(options.cors?.allowMethods).toBe("GET,POST,OPTIONS");
  });
});
