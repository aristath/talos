import type { SoulSwitchErrorCode, SoulSwitchErrorDetails } from "./types.js";

export class SoulSwitchError extends Error {
  readonly code: SoulSwitchErrorCode;
  readonly details?: SoulSwitchErrorDetails;

  constructor(params: {
    code: SoulSwitchErrorCode;
    message: string;
    cause?: unknown;
    details?: SoulSwitchErrorDetails;
  }) {
    super(params.message, { cause: params.cause });
    this.name = "SoulSwitchError";
    this.code = params.code;
    if (params.details !== undefined) {
      this.details = params.details;
    }
  }
}

export function toSoulSwitchErrorLike(error: unknown): { name: string; message: string; code?: string } {
  if (error instanceof SoulSwitchError) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return {
    name: "UnknownError",
    message: String(error),
  };
}
