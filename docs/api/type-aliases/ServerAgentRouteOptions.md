[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / ServerAgentRouteOptions

# Type Alias: ServerAgentRouteOptions

> **ServerAgentRouteOptions** = `object`

Options for `createAgentRoutes()`.

## Properties

### allowedInputRoots?

> `optional` **allowedInputRoots?**: `string`[]

Directories a request's `input.images` / `input.files` entries may name as
local paths. Empty or omitted (the default) refuses every local path: a
server must not read its own disk on a caller's say-so unless the operator
names where.

---

### maxInputBytes?

> `optional` **maxInputBytes?**: `number`

Largest single attachment accepted, in bytes. Default 50 MB.
