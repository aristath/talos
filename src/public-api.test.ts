import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("public API contract", () => {
  it("exports the expected runtime symbols", () => {
    const keys = Object.keys(api).sort();

    expect(keys).toEqual([
      "SOULSWITCH_PLUGIN_API_VERSION",
      "SoulSwitchError",
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
      "createSoulSwitch",
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
    expect(typeof api.SOULSWITCH_PLUGIN_API_VERSION).toBe("number");
    expect(api.SOULSWITCH_PLUGIN_API_VERSION).toBeGreaterThan(0);
  });
});
