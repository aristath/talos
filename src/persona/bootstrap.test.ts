import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedPersonaWorkspace } from "./bootstrap.js";

const tmpDirs: string[] = [];

async function createTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persona-bootstrap-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("seedPersonaWorkspace", () => {
  it("creates default persona files when missing", async () => {
    const dir = await createTmpDir();

    const result = await seedPersonaWorkspace(dir);

    expect(result.created).toContain("AGENTS.md");
    expect(result.created).toContain("SOUL.md");
    const agents = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
    expect(agents.includes("# AGENTS.md")).toBe(true);
  });

  it("does not overwrite by default and supports overwrite mode", async () => {
    const dir = await createTmpDir();
    const userContent = "# SOUL.md\n\ncustom\n";
    await fs.writeFile(path.join(dir, "SOUL.md"), userContent, "utf8");

    const first = await seedPersonaWorkspace(dir);
    expect(first.existing).toContain("SOUL.md");
    const soulBefore = await fs.readFile(path.join(dir, "SOUL.md"), "utf8");
    expect(soulBefore).toBe(userContent);

    const second = await seedPersonaWorkspace(dir, { overwrite: true });
    expect(second.created).toContain("SOUL.md");
    const soulAfter = await fs.readFile(path.join(dir, "SOUL.md"), "utf8");
    expect(soulAfter).not.toBe(userContent);
  });
});
