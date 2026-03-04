import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPersonaSystemPrompt, loadPersonaSnapshot } from "./loader.js";

const tmpDirs: string[] = [];

async function createTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persona-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("loadPersonaSnapshot", () => {
  it("loads regular persona files", async () => {
    const dir = await createTmpDir();
    await fs.writeFile(path.join(dir, "SOUL.md"), "core persona", "utf8");
    await fs.writeFile(path.join(dir, "TOOLS.md"), "local tools", "utf8");

    const snapshot = await loadPersonaSnapshot(dir);

    expect(snapshot.files["SOUL.md"]).toBe("core persona");
    expect(snapshot.files["TOOLS.md"]).toBe("local tools");
  });

  it("filters bootstrap files for subagent sessions", async () => {
    const dir = await createTmpDir();
    await fs.writeFile(path.join(dir, "AGENTS.md"), "a", "utf8");
    await fs.writeFile(path.join(dir, "HEARTBEAT.md"), "h", "utf8");
    await fs.writeFile(path.join(dir, "BOOTSTRAP.md"), "b", "utf8");

    const snapshot = await loadPersonaSnapshot(dir, {
      sessionKind: "subagent",
    });

    expect(snapshot.files["AGENTS.md"]).toBe("a");
    expect(snapshot.files["HEARTBEAT.md"]).toBeUndefined();
    expect(snapshot.files["BOOTSTRAP.md"]).toBeUndefined();
  });

  it("loads MEMORY.md only in main sessions", async () => {
    const dir = await createTmpDir();
    await fs.writeFile(path.join(dir, "MEMORY.md"), "long-term", "utf8");

    const mainSnapshot = await loadPersonaSnapshot(dir, { sessionKind: "main" });
    const cronSnapshot = await loadPersonaSnapshot(dir, { sessionKind: "cron" });

    expect(mainSnapshot.files["MEMORY.md"]).toBe("long-term");
    expect(cronSnapshot.files["MEMORY.md"]).toBeUndefined();
  });

  it("rejects symlinked persona files", async () => {
    const dir = await createTmpDir();
    const outside = await createTmpDir();
    await fs.writeFile(path.join(outside, "outside.md"), "external", "utf8");
    await fs.symlink(path.join(outside, "outside.md"), path.join(dir, "AGENTS.md"));

    await expect(loadPersonaSnapshot(dir)).rejects.toMatchObject({
      code: "PERSONA_FILE_UNSAFE",
    });
  });

  it("loads extra patterns and reports diagnostics", async () => {
    const dir = await createTmpDir();
    await fs.mkdir(path.join(dir, "nested"), { recursive: true });
    await fs.writeFile(path.join(dir, "SOUL.md"), "soul", "utf8");
    await fs.writeFile(path.join(dir, "nested", "SOUL.md"), "nested soul", "utf8");

    const snapshot = await loadPersonaSnapshot(dir, {
      extraPatterns: ["nested/SOUL.md", "nope.md"],
    });

    expect(snapshot.files["SOUL.md"]).toBe("nested soul");
    expect(snapshot.bootstrapFiles.some((f) => f.path.endsWith(path.join("nested", "SOUL.md")))).toBe(
      true,
    );
    expect(snapshot.bootstrapFiles.some((f) => f.content === "nested soul")).toBe(true);
    expect(snapshot.diagnostics.some((d) => d.reason === "invalid-persona-filename")).toBe(true);
  });

  it("applies bootstrap context budgets when building prompt", async () => {
    const dir = await createTmpDir();
    await fs.writeFile(path.join(dir, "SOUL.md"), "x".repeat(2000), "utf8");

    const snapshot = await loadPersonaSnapshot(dir, { sessionKind: "main" });
    const prompt = buildPersonaSystemPrompt(snapshot, {
      bootstrapMaxChars: 200,
      bootstrapTotalMaxChars: 300,
    });

    expect(prompt?.length ?? 0).toBeLessThanOrEqual(300 + 200);
    expect(prompt?.includes("truncated")).toBe(true);
  });
});
