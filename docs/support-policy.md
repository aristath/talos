# Support Policy

## Runtime baseline

- Node.js 22+

## Versioning

- Public TypeScript API is semver-governed.
- Plugin API compatibility is controlled through `TALOS_PLUGIN_API_VERSION`.

## Backward compatibility

- Minor and patch releases should remain backward-compatible for public APIs.
- Breaking changes are reserved for major releases.

## Security updates

- Security-impacting fixes may be shipped in patch releases.
- Redaction and sandbox controls should be considered required hardening features in production environments.

## Testing expectations

- `pnpm check`
- `pnpm test`
- `pnpm build`

All three should pass before release.
