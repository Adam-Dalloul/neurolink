[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / ToolExecutionGuards

# Type Alias: ToolExecutionGuards

> **ToolExecutionGuards** = `object`

The things a native loop wraps around every tool call that the shared engine
does not do itself.

NOT Gemini-specific, despite where this started. Both Vertex+Claude loops
apply these guards directly via `guardToolExecutor`, and the Gemini adapter
applies them to hydrated tools, so the former `GeminiToolExecutionGuards`
name described the first caller rather than the contract — and pointed the
next reader at the wrong provider family.

All optional, and the whole object is optional, because callers differ:
Vertex bounds tool execution and runs a stall watchdog, AI Studio does
neither. Passing nothing leaves an executor exactly as the caller supplied
it, so this cannot quietly give a provider behaviour its hand-rolled loops
never had.

## Properties

### toolTimeoutMs?

> `optional` **toolTimeoutMs?**: `number` \| `null`

Upper bound on a single execute(). Omit, or pass `null`, for no bound.

`null` is accepted as well as `undefined` because it is what a caller's
own `toolTimeoutMs: null` resolves to, and the two must not diverge: a
value that means "unbounded" at the public surface cannot arrive here
meaning "0ms".

---

### abortSignal?

> `optional` **abortSignal?**: `AbortSignal`

Turn-level abort, raced against the call so a deadline or caller cancel is
observed immediately instead of after the tool settles.

---

### onProgress?

> `optional` **onProgress?**: () => `void`

Stall-watchdog ping, called either side of the await. The watchdog is a
whole-turn interval measuring wall-clock since the last mark, so a
legitimately slow tool reads as a stalled turn without this.

#### Returns

`void`
