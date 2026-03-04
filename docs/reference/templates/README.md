# Persona Templates

Talos can load persona seed templates from this directory at runtime.

- File names must match the persona bootstrap set (`AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md`, `memory.md`).
- If a template file is missing here, Talos falls back to embedded defaults.
- Leading Markdown frontmatter is stripped when loading.

You can override the lookup directory for testing with `TALOS_PERSONA_TEMPLATE_DIR`.
