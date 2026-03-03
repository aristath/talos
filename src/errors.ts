import type { TalosErrorCode, TalosErrorDetails } from "./types.js";

export class TalosError extends Error {
  readonly code: TalosErrorCode;
  readonly details?: TalosErrorDetails;

  constructor(params: {
    code: TalosErrorCode;
    message: string;
    cause?: unknown;
    details?: TalosErrorDetails;
  }) {
    super(params.message, { cause: params.cause });
    this.name = "TalosError";
    this.code = params.code;
    if (params.details !== undefined) {
      this.details = params.details;
    }
  }
}

export function toTalosErrorLike(error: unknown): { name: string; message: string; code?: string } {
  if (error instanceof TalosError) {
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
