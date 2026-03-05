import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SoulSwitchError } from "../errors.js";
import { redactValue } from "../security/redaction.js";
import type { SoulSwitchStateSnapshot } from "../types.js";

function ensureSnapshotShape(input: unknown): SoulSwitchStateSnapshot {
  if (!input || typeof input !== "object") {
    throw new SoulSwitchError({
      code: "CONFIG_INVALID",
      message: "State snapshot must be an object.",
    });
  }

  const candidate = input as {
    events?: unknown;
    runs?: unknown;
    sessions?: unknown;
  };

  if (!Array.isArray(candidate.events)) {
    throw new SoulSwitchError({
      code: "CONFIG_INVALID",
      message: "State snapshot field 'events' must be an array.",
    });
  }

  if (!Array.isArray(candidate.runs)) {
    throw new SoulSwitchError({
      code: "CONFIG_INVALID",
      message: "State snapshot field 'runs' must be an array.",
    });
  }

  if (typeof candidate.sessions !== "undefined" && !Array.isArray(candidate.sessions)) {
    throw new SoulSwitchError({
      code: "CONFIG_INVALID",
      message: "State snapshot field 'sessions' must be an array when present.",
    });
  }

  const snapshot: SoulSwitchStateSnapshot = {
    events: candidate.events as SoulSwitchStateSnapshot["events"],
    runs: candidate.runs as SoulSwitchStateSnapshot["runs"],
  };
  if (Array.isArray(candidate.sessions)) {
    snapshot.sessions = candidate.sessions as NonNullable<SoulSwitchStateSnapshot["sessions"]>;
  }
  return snapshot;
}

export async function saveStateSnapshot(
  filePath: string,
  snapshot: SoulSwitchStateSnapshot,
  options?: {
    redactKeys?: string[];
  },
): Promise<string> {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) {
    throw new SoulSwitchError({
      code: "CONFIG_INVALID",
      message: "State file path is required.",
    });
  }
  const targetPath = path.resolve(normalizedPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const safeSnapshot = redactValue(snapshot, options?.redactKeys) as SoulSwitchStateSnapshot;
  const payload = `${JSON.stringify(safeSnapshot, null, 2)}\n`;
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now().toString(36)}-${randomUUID()}`;
  await fs.writeFile(tmpPath, payload, "utf8");
  await fs.rename(tmpPath, targetPath);
  return targetPath;
}

export async function loadStateSnapshot(filePath: string): Promise<{ path: string; snapshot: SoulSwitchStateSnapshot }> {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) {
    throw new SoulSwitchError({
      code: "CONFIG_INVALID",
      message: "State file path is required.",
    });
  }
  const targetPath = path.resolve(normalizedPath);
  const raw = await fs.readFile(targetPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SoulSwitchError({
      code: "CONFIG_INVALID",
      message: `State file contains invalid JSON: ${targetPath}`,
      cause: error,
    });
  }
  const snapshot = ensureSnapshotShape(parsed);
  return {
    path: targetPath,
    snapshot,
  };
}
