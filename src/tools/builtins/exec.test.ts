import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createExecTool } from "./exec.js";

describe("createExecTool", () => {
  it("executes command in host mode", async () => {
    const tool = createExecTool({ timeoutMs: 5_000 });
    const result = await tool.run(
      {
        command: process.execPath,
        args: ["-e", "console.log('hello-exec')"],
      },
      { agentId: "main" },
    );

    expect(result.content).toContain("hello-exec");
  });

  it("blocks disallowed command in sandbox mode", async () => {
    const tool = createExecTool({
      mode: "sandbox",
      sandbox: {
        allowedCommands: ["not-node"],
      },
    });

    await expect(
      tool.run(
        {
          command: process.execPath,
          args: ["-e", "console.log('x')"],
        },
        { agentId: "main" },
      ),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
  });

  it("blocks disallowed working directory in sandbox mode", async () => {
    const tool = createExecTool({
      mode: "sandbox",
      sandbox: {
        allowedCommands: [process.execPath],
        allowedPaths: [path.resolve(os.homedir(), "never-this")],
      },
    });

    await expect(
      tool.run(
        {
          command: process.execPath,
          args: ["-e", "console.log('x')"],
          cwd: process.cwd(),
        },
        { agentId: "main" },
      ),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
  });

  it("requires cwd when allowedPaths are configured in sandbox mode", async () => {
    const tool = createExecTool({
      mode: "sandbox",
      sandbox: {
        allowedCommands: [process.execPath],
        allowedPaths: [process.cwd()],
      },
    });

    await expect(
      tool.run(
        {
          command: process.execPath,
          args: ["-e", "console.log('x')"],
        },
        { agentId: "main" },
      ),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
  });

  it("fails when process output exceeds maxOutputBytes", async () => {
    const tool = createExecTool({
      maxOutputBytes: 64,
      timeoutMs: 5_000,
    });

    await expect(
      tool.run(
        {
          command: process.execPath,
          args: ["-e", "console.log('x'.repeat(1024))"],
        },
        { agentId: "main" },
      ),
    ).rejects.toMatchObject({ code: "TOOL_OUTPUT_LIMIT" });
  });
});
