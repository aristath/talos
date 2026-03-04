import { describe, expect, it, vi } from "vitest";
import { createImageTool, createPdfTool } from "./media.js";

describe("media builtins", () => {
  it("dedupes inputs and strips @ prefix", async () => {
    const analyze = vi.fn(async () => ({ text: "ok" }));
    const tool = createImageTool({ analyze });

    await tool.run(
      {
        image: "@/tmp/a.png",
        images: ["/tmp/a.png", "@/tmp/b.png"],
      },
      { agentId: "main" },
    );

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0]?.[0]?.inputs).toEqual(["/tmp/a.png", "/tmp/b.png"]);
  });

  it("rejects unsupported URI schemes", async () => {
    const imageTool = createImageTool({ analyze: async () => ({ text: "ok" }) });
    await expect(
      imageTool.run({ image: "image:0" }, { agentId: "main" }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });

    const pdfTool = createPdfTool({ analyze: async () => ({ text: "ok" }) });
    await expect(
      pdfTool.run({ pdf: "foo:bar" }, { agentId: "main" }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
  });
});
