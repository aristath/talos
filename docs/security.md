# Security Model

Talos uses a trusted-operator model.

## Trust boundaries

- The host process and filesystem are trusted by default.
- Plugins are untrusted code unless you trust the plugin source.

## Controls

- Plugin capability gates (`providers`, `hooks`)
- Plugin API version compatibility check
- Model timeout/retry/fallback
- Persona file boundary checks (symlink, hardlink, max-size, and open-time identity guards)
- Optional state redaction (`security.redactKeys`) on persisted diagnostics

## Operational guidance

- Keep plugin set minimal and source-controlled.
- Enable state redaction for secrets.
