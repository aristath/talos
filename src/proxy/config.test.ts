import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOpenAIProxyOptionsFromFile } from "./config.js";

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
});
