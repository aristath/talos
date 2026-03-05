import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadStateSnapshot, saveStateSnapshot } from "./persistence.js";
import type { SoulSwitchStateSnapshot } from "../types.js";

const tmpDirs: string[] = [];

async function createTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-persist-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("saveStateSnapshot", () => {
  it("redacts configured keys in serialized payload", async () => {
    const dir = await createTmpDir();
    const filePath = path.join(dir, "state.json");
    const snapshot = {
      events: [
        {
          type: "run.failed",
          at: new Date().toISOString(),
          runId: "r1",
          data: {
            authorization: "secret-token",
            error: {
              name: "Error",
              message: "boom",
            },
          },
        },
      ],
      runs: [],
    } as unknown as SoulSwitchStateSnapshot;

    await saveStateSnapshot(filePath, snapshot, {
      redactKeys: ["authorization"],
    });

    const raw = await fs.readFile(filePath, "utf8");
    expect(raw.includes("secret-token")).toBe(false);
    expect(raw.includes("[REDACTED]")).toBe(true);
  });

  it("rejects invalid state JSON payloads", async () => {
    const dir = await createTmpDir();
    const filePath = path.join(dir, "bad.json");
    await fs.writeFile(filePath, "{ not-json", "utf8");

    await expect(loadStateSnapshot(filePath)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });

  it("rejects state snapshots with invalid shape", async () => {
    const dir = await createTmpDir();
    const filePath = path.join(dir, "bad-shape.json");
    await fs.writeFile(filePath, JSON.stringify({ events: {}, runs: [] }), "utf8");

    await expect(loadStateSnapshot(filePath)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });

  it("rejects state snapshots when sessions is not an array", async () => {
    const dir = await createTmpDir();
    const filePath = path.join(dir, "bad-sessions.json");
    await fs.writeFile(filePath, JSON.stringify({ events: [], runs: [], sessions: {} }), "utf8");

    await expect(loadStateSnapshot(filePath)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });
});
