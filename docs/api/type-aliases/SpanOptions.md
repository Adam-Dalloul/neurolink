[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / SpanOptions

# Type Alias: SpanOptions

> **SpanOptions** = `object`

## Properties

### name

> **name**: `string`

---

### tracer

> **tracer**: `Tracer`

---

### kind?

> `optional` **kind?**: `SpanKind`

---

### attributes?

> `optional` **attributes?**: `Record`\<`string`, `string` \| `number` \| `boolean` \| `undefined`\>

---

### expectedFailure?

> `optional` **expectedFailure?**: (`error`) => `boolean`

Marks a thrown error as an expected skip whose Langfuse level the span set itself, so `withSpan` keeps it instead of raising ERROR.

#### Parameters

##### error

`unknown`

#### Returns

`boolean`

---

### detached?

> `optional` **detached?**: `boolean`

Keeps the span out of the active context, so spans started inside `fn` parent to the nearest ancestor that is exported.
