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
  const hasLoneSurrogates = (value: string): boolean => {
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(i + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          return true;
        }
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        const prev = value.charCodeAt(i - 1);
        if (!(prev >= 0xd800 && prev <= 0xdbff)) {
          return true;
        }
      }
    }
    return false;
  };

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

  it("does not inject missing optional memory files", async () => {
    const dir = await createTmpDir();
    await fs.writeFile(path.join(dir, "SOUL.md"), "core", "utf8");

    const snapshot = await loadPersonaSnapshot(dir, { sessionKind: "main" });

    expect(snapshot.bootstrapFiles.some((file) => file.name === "MEMORY.md")).toBe(false);
    expect(snapshot.bootstrapFiles.some((file) => file.name === "memory.md")).toBe(false);
    const prompt = buildPersonaSystemPrompt(snapshot);
    expect(prompt?.includes("## MEMORY.md\n[MISSING]")).toBe(false);
    expect(prompt?.includes("## memory.md\n[MISSING]")).toBe(false);
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

  it("rejects hard-linked persona files", async () => {
    const dir = await createTmpDir();
    const outside = await createTmpDir();
    const source = path.join(outside, "source.md");
    await fs.writeFile(source, "external", "utf8");
    await fs.link(source, path.join(dir, "AGENTS.md"));

    await expect(loadPersonaSnapshot(dir)).rejects.toMatchObject({
      code: "PERSONA_FILE_UNSAFE",
    });
  });

  it("rejects oversized persona files", async () => {
    const dir = await createTmpDir();
    await fs.writeFile(path.join(dir, "AGENTS.md"), "x".repeat(2 * 1024 * 1024 + 1), "utf8");

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

  it("reports security diagnostics for extra files outside workspace", async () => {
    const dir = await createTmpDir();
    const outside = await createTmpDir();
    await fs.writeFile(path.join(outside, "SOUL.md"), "outside", "utf8");

    const snapshot = await loadPersonaSnapshot(dir, {
      extraPatterns: ["../" + path.basename(outside) + "/SOUL.md"],
    });

    expect(snapshot.bootstrapFiles.some((f) => f.content === "outside")).toBe(false);
    expect(snapshot.diagnostics.some((d) => d.reason === "security")).toBe(true);
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

  it("keeps utf16 pairs intact during truncation", async () => {
    const dir = await createTmpDir();
    await fs.writeFile(path.join(dir, "SOUL.md"), "🙂".repeat(600), "utf8");

    const snapshot = await loadPersonaSnapshot(dir, { sessionKind: "main" });
    const prompt = buildPersonaSystemPrompt(snapshot, {
      bootstrapMaxChars: 101,
      bootstrapTotalMaxChars: 160,
    });

    expect(prompt).toBeDefined();
    expect(hasLoneSurrogates(prompt ?? "")).toBe(false);
  });

  it("stops processing once remaining budget is below file minimum", () => {
    const prompt = buildPersonaSystemPrompt(
      {
        workspaceDir: "/w",
        sessionKind: "main",
        files: {},
        diagnostics: [],
        bootstrapFiles: [
          {
            name: "AGENTS.md",
            path: "/w/AGENTS.md",
            content: "a".repeat(200),
            missing: false,
          },
          {
            name: "SOUL.md",
            path: "/w/SOUL.md",
            content: "soul",
            missing: false,
          },
          {
            name: "USER.md",
            path: "/w/USER.md",
            missing: true,
          },
        ],
      },
      {
        bootstrapMaxChars: 60,
        bootstrapTotalMaxChars: 100,
      },
    );

    expect(prompt?.includes("## AGENTS.md")).toBe(true);
    expect(prompt?.includes("## SOUL.md")).toBe(false);
    expect(prompt?.includes("## USER.md")).toBe(false);
  });
});
