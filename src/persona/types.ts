export type PersonaFileName =
  | "AGENTS.md"
  | "SOUL.md"
  | "TOOLS.md"
  | "IDENTITY.md"
  | "USER.md"
  | "HEARTBEAT.md"
  | "BOOTSTRAP.md"
  | "MEMORY.md"
  | "memory.md";

export type PersonaSessionKind = "main" | "subagent" | "cron";
export type PersonaContextMode = "full" | "lightweight";
export type PersonaRunKind = "default" | "heartbeat" | "cron";

export type PersonaBootstrapFile = {
  name: PersonaFileName;
  path: string;
  content?: string;
  missing: boolean;
};

export type PersonaLoadDiagnosticCode =
  | "invalid-persona-filename"
  | "missing"
  | "security"
  | "io";

export type PersonaLoadDiagnostic = {
  path: string;
  reason: PersonaLoadDiagnosticCode;
  detail: string;
};

export type PersonaSnapshot = {
  workspaceDir: string;
  sessionKind: PersonaSessionKind;
  files: Partial<Record<PersonaFileName, string>>;
  bootstrapFiles: PersonaBootstrapFile[];
  diagnostics: PersonaLoadDiagnostic[];
};
