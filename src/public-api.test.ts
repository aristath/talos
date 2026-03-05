import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("public API contract", () => {
  it("exports the expected runtime symbols", () => {
    const keys = Object.keys(api).sort();

    expect(keys).toEqual([
      "TALOS_PLUGIN_API_VERSION",
      "TalosError",
      "assertPluginCompatibility",
      "createBrowserTool",
      "createCanvasTool",
      "createImageTool",
      "createLlmTaskTool",
      "createOpenAICompatibleProxy",
      "createOpenAICompatibleProxyFromFile",
      "createOpenAICompatibleProxyServer",
      "createOpenAICompatibleProxyServerFromFile",
      "createPdfTool",
      "createSessionTools",
      "createTalos",
      "createWebFetchTool",
      "createWebSearchTool",
      "definePlugin",
      "discoverPluginEntryPaths",
      "loadOpenAIProxyOptionsFromFile",
      "loadOpenAIProxyServerOptionsFromFile",
      "loadPluginFromPath",
      "redactValue",
      "seedPersonaWorkspace",
      "startOpenAICompatibleProxyServerFromFile",
    ]);
  });

  it("exports plugin API version as number", () => {
    expect(typeof api.TALOS_PLUGIN_API_VERSION).toBe("number");
    expect(api.TALOS_PLUGIN_API_VERSION).toBeGreaterThan(0);
  });
});
