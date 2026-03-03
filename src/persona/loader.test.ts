import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPersonaSnapshot } from "./loader.js";

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

    const snapshot = await loadPersonaSnapshot(dir);

    expect(snapshot.files["SOUL.md"]).toBe("core persona");
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
});
