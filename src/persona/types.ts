export type PersonaFileName = "AGENTS.md" | "SOUL.md" | "IDENTITY.md" | "USER.md";

export type PersonaSnapshot = {
  workspaceDir: string;
  files: Partial<Record<PersonaFileName, string>>;
};
