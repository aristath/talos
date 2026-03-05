import { describe, expect, it } from "vitest";
import { SOULSWITCH_PLUGIN_API_VERSION, assertPluginCompatibility, definePlugin } from "./plugin-sdk.js";

describe("plugin-sdk", () => {
  it("assigns default apiVersion when defining plugin", () => {
    const plugin = definePlugin({
      id: "demo",
      setup() {
        return undefined;
      },
    });

    expect(plugin.apiVersion).toBe(SOULSWITCH_PLUGIN_API_VERSION);
  });

  it("rejects incompatible plugin api version", () => {
    expect(() =>
      assertPluginCompatibility({
        id: "future",
        apiVersion: SOULSWITCH_PLUGIN_API_VERSION + 1,
        setup() {
          return undefined;
        },
      }),
    ).toThrowError(/uses apiVersion/);
  });

  it("accepts compatible plugin declaration", () => {
    const plugin = definePlugin({
      id: "ok",
      capabilities: ["hooks"],
      setup() {
        return undefined;
      },
    });

    expect(() => assertPluginCompatibility(plugin)).not.toThrow();
  });
});
