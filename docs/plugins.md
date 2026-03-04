# Plugin Authoring

Talos exposes a lightweight plugin contract:

- `id` (required)
- `apiVersion` (optional, defaults to current SDK version)
- `capabilities` (optional list of `tools`, `providers`, `hooks`)
- `setup(api)`

Use SDK helpers:

- `definePlugin(...)`
- `assertPluginCompatibility(...)`
- `TALOS_PLUGIN_API_VERSION`

## Example

```ts
import { definePlugin } from "talos"

export default definePlugin({
  id: "example-plugin",
  capabilities: ["hooks"],
  setup(api) {
    api.on("beforeRun", () => {
      // hook logic
    })
  },
})
```

## Teardown

`setup(api)` may return a teardown function (sync or async). Talos executes teardown when `removePlugin(pluginId)` is called.

## Metadata

Talos can expose plugin metadata through:

- `listPluginSummaries()`
- `getPluginSummary(pluginId)`

Summaries include API version, declared capabilities, owned tools/providers, and registered hook names.
