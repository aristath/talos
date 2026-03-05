# Persona Templates

SoulSwitch can load persona seed templates from this directory at runtime.

- File names must match the persona bootstrap set (`AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md`, `memory.md`).
- If a template file is missing here, SoulSwitch falls back to embedded defaults.
- Leading Markdown frontmatter is stripped when loading.

Note: on case-insensitive filesystems, `MEMORY.md` and `memory.md` cannot both exist on disk. SoulSwitch
automatically falls back to the embedded `memory.md` template when only `MEMORY.md` is present.

You can override the lookup directory for testing with `SOULSWITCH_PERSONA_TEMPLATE_DIR`.
