import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("public API contract", () => {
  it("exports the expected runtime symbols", () => {
    const keys = Object.keys(api).sort();

    expect(keys).toEqual([
      "TALOS_PLUGIN_API_VERSION",
      "TalosError",
      "assertPluginCompatibility",
      "createExecTool",
      "createImageTool",
      "createLlmTaskTool",
      "createPdfTool",
      "createSessionTools",
      "createTalos",
      "createWebFetchTool",
      "createWebSearchTool",
      "definePlugin",
      "discoverPluginEntryPaths",
      "loadPluginFromPath",
      "redactValue",
      "seedPersonaWorkspace",
    ]);
  });

  it("exports plugin API version as number", () => {
    expect(typeof api.TALOS_PLUGIN_API_VERSION).toBe("number");
    expect(api.TALOS_PLUGIN_API_VERSION).toBeGreaterThan(0);
  });
});
