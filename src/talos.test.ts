import { describe, expect, it } from "vitest";
import { createTalos } from "./talos.js";

describe("createTalos", () => {
  it("creates an engine with registration APIs", () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    expect(typeof talos.registerAgent).toBe("function");
    expect(typeof talos.registerTool).toBe("function");
    expect(typeof talos.registerPlugin).toBe("function");
    expect(typeof talos.run).toBe("function");
  });
});
