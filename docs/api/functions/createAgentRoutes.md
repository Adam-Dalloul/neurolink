[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / createAgentRoutes

# Function: createAgentRoutes()

> **createAgentRoutes**(`basePath?`, `options?`): [`RouteGroup`](../type-aliases/RouteGroup.md)

Create agent routes

## Parameters

### basePath?

`string` = `"/api"`

### options?

[`ServerAgentRouteOptions`](../type-aliases/ServerAgentRouteOptions.md)

`allowedInputRoots` (default: local-path attachments are
refused) and `maxInputBytes` for `input.images` / `input.files`.

## Returns

[`RouteGroup`](../type-aliases/RouteGroup.md)
