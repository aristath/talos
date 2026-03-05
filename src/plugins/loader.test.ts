import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverPluginEntryPaths, loadPluginFromPath } from "./loader.js";

const tmpDirs: string[] = [];

async function createTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-plugin-loader-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("plugin loader", () => {
  it("discovers plugin entry files", async () => {
    const dir = await createTmpDir();
    await fs.writeFile(path.join(dir, "a.mjs"), "export default { id: 'a', async setup() {} };", "utf8");
    await fs.writeFile(path.join(dir, "b.js"), "export default { id: 'b', async setup() {} };", "utf8");
    await fs.writeFile(path.join(dir, "ignore.txt"), "x", "utf8");

    const files = await discoverPluginEntryPaths(dir);

    expect(files).toHaveLength(2);
    expect(files[0]?.endsWith("a.mjs")).toBe(true);
    expect(files[1]?.endsWith("b.js")).toBe(true);
  });

  it("loads plugin from default export", async () => {
    const dir = await createTmpDir();
    const pluginPath = path.join(dir, "plugin.mjs");
    await fs.writeFile(
      pluginPath,
      "export default { id: 'ok', capabilities: ['hooks'], async setup(api) { api.on('beforeRun', () => undefined); } };",
      "utf8",
    );

    const plugin = await loadPluginFromPath(pluginPath);

    expect(plugin.id).toBe("ok");
  });

  it("rejects invalid plugin modules", async () => {
    const dir = await createTmpDir();
    const pluginPath = path.join(dir, "bad.mjs");
    await fs.writeFile(pluginPath, "export default { nope: true };", "utf8");

    await expect(loadPluginFromPath(pluginPath)).rejects.toMatchObject({
      code: "PLUGIN_LOAD_FAILED",
    });
  });
});
