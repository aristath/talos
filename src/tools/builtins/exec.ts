import path from "node:path";
import { spawn } from "node:child_process";
import { TalosError } from "../../errors.js";
import type { ExecToolOptions, ToolDefinition, ToolResult } from "../../types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

function normalize(value: string): string {
  return value.trim();
}

function parseExecArgs(input: Record<string, unknown>): {
  command: string;
  args: string[];
  cwd?: string;
} {
  const command = typeof input.command === "string" ? normalize(input.command) : "";
  if (!command) {
    throw new TalosError({
      code: "TOOL_FAILED",
      message: "exec tool requires a non-empty 'command' string.",
    });
  }
  const args = Array.isArray(input.args)
    ? input.args.map((arg) => String(arg))
    : typeof input.args === "string"
      ? input.args
          .split(" ")
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
      : [];
  const cwd = typeof input.cwd === "string" && input.cwd.trim() ? path.resolve(input.cwd) : undefined;
  return { command, args, ...(cwd ? { cwd } : {}) };
}

function assertSandboxAllowed(
  parsed: { command: string; cwd?: string },
  sandbox?: {
    allowedCommands?: string[];
    allowedPaths?: string[];
    requireCwdInAllowedPaths?: boolean;
  },
): void {
  const commands = new Set((sandbox?.allowedCommands ?? []).map((value) => value.trim()).filter(Boolean));
  if (commands.size > 0 && !commands.has(parsed.command)) {
    throw new TalosError({
      code: "TOOL_NOT_ALLOWED",
      message: `Command is not allowed in sandbox mode: ${parsed.command}`,
    });
  }

  const paths = (sandbox?.allowedPaths ?? []).map((value) => path.resolve(value));
  const cwd = parsed.cwd;
  const requireCwd = sandbox?.requireCwdInAllowedPaths ?? true;
  if (paths.length > 0 && !cwd && requireCwd) {
    throw new TalosError({
      code: "TOOL_NOT_ALLOWED",
      message: "Sandbox mode requires explicit cwd when allowedPaths are configured.",
    });
  }
  if (paths.length > 0 && cwd) {
    const allowed = paths.some((allowedPath) => {
      return cwd === allowedPath || cwd.startsWith(`${allowedPath}${path.sep}`);
    });
    if (!allowed) {
      throw new TalosError({
        code: "TOOL_NOT_ALLOWED",
        message: `Working directory is not allowed in sandbox mode: ${cwd}`,
      });
    }
  }
}

async function runProcess(params: {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}): Promise<ToolResult> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (value: ToolResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    const safeReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let totalOutputBytes = 0;
    const appendChunk = (target: "stdout" | "stderr", chunk: Buffer | string) => {
      const text = chunk.toString();
      totalOutputBytes += Buffer.byteLength(text);
      if (totalOutputBytes > params.maxOutputBytes) {
        child.kill("SIGKILL");
        safeReject(
          new TalosError({
            code: "TOOL_OUTPUT_LIMIT",
            message: `exec tool exceeded max output bytes (${params.maxOutputBytes}).`,
            details: {
              maxOutputBytes: params.maxOutputBytes,
            },
          }),
        );
        return;
      }
      if (target === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
    };
    child.stdout.on("data", (chunk) => {
      appendChunk("stdout", chunk);
    });
    child.stderr.on("data", (chunk) => {
      appendChunk("stderr", chunk);
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      safeReject(
        new TalosError({
          code: "TOOL_TIMEOUT",
          message: `exec tool timed out after ${params.timeoutMs}ms`,
        }),
      );
    }, params.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      safeReject(
        new TalosError({
          code: "TOOL_FAILED",
          message: `Failed to spawn process: ${params.command}`,
          cause: error,
        }),
      );
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        safeResolve({
          content: stdout.trim(),
          data: {
            stdout,
            stderr,
            exitCode: code,
          },
        });
        return;
      }
      safeReject(
        new TalosError({
          code: "TOOL_FAILED",
          message: `Process exited with code ${String(code)}: ${params.command}`,
          details: {
            stdout,
            stderr,
            exitCode: code,
          },
        }),
      );
    });
  });
}

export function createExecTool(options?: ExecToolOptions): ToolDefinition {
  const mode = options?.mode ?? "host";
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return {
    name: options?.name ?? "exec",
    description: options?.description ?? "Execute a shell command",
    async run(args) {
      const parsed = parseExecArgs(args);
      const cwd = parsed.cwd ?? options?.defaultCwd;
      if (mode === "sandbox") {
        assertSandboxAllowed(
          {
            command: parsed.command,
            ...(cwd ? { cwd } : {}),
          },
          options?.sandbox,
        );
      }
      return await runProcess({
        command: parsed.command,
        args: parsed.args,
        ...(cwd ? { cwd } : {}),
        timeoutMs,
        maxOutputBytes,
      });
    },
  };
}
