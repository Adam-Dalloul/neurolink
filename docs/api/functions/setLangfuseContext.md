[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / setLangfuseContext

# Function: setLangfuseContext()

> **setLangfuseContext**\<`T`\>(`params`, `fn`): `T`

## Type Parameters

### T

`T`

## Parameters

### params

[`NeurolinkTraceContext`](../type-aliases/NeurolinkTraceContext.md)

{NeurolinkTraceContext} - User, session, trace name, tags and metadata for the trace.

### fn

() => `T`

{() => T} - Work to run inside the propagated context.

## Returns

`T`

Whatever `fn` returns.

## Description

Runs `fn` with trace attributes propagated to every span it creates. `conversationId` and `requestId` become metadata; empty values are dropped. Metadata values of up to 200 characters once stringified are on every observation; longer values and arrays are recorded in full on the trace only, written by the trace root.

## Example

```ts
await setLangfuseContext({ userId: "u1", sessionId: "s1" }, () =>
  neurolink.generate({ input: { text: "hi" } }),
);
```
