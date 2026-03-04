import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveStateSnapshot } from "./persistence.js";
import type { TalosStateSnapshot } from "../types.js";

const tmpDirs: string[] = [];

async function createTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persist-"));
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
    } as unknown as TalosStateSnapshot;

    await saveStateSnapshot(filePath, snapshot, {
      redactKeys: ["authorization"],
    });

    const raw = await fs.readFile(filePath, "utf8");
    expect(raw.includes("secret-token")).toBe(false);
    expect(raw.includes("[REDACTED]")).toBe(true);
  });
});
