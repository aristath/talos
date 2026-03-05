# Security Model

SoulSwitch uses a trusted-operator model.

## Trust boundaries

- The host process and filesystem are trusted by default.
- Plugins are untrusted code unless you trust the plugin source.
- Tool execution in `host` mode has host-level access.
- Tool execution in `sandbox` mode enforces command/path policy constraints but is not OS-level container isolation.

## Controls

- Plugin capability gates (`tools`, `providers`, `hooks`)
- Plugin API version compatibility check
- Tool policy stack (global, agent, run)
- Tool timeout and cancellation
- Model timeout/retry/fallback
- Persona file boundary checks (symlink, hardlink, max-size, and open-time identity guards)
- Optional state redaction (`security.redactKeys`) on persisted diagnostics

## Operational guidance

- Prefer sandbox mode for command tools.
- Restrict allowed commands/paths aggressively.
- Keep plugin set minimal and source-controlled.
- Enable state redaction for secrets.
