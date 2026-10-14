[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / NeurolinkLangfuseConfig

# Type Alias: NeurolinkLangfuseConfig

> **NeurolinkLangfuseConfig** = `object`

## Description

Langfuse exporter options. Every field falls back to its `LANGFUSE_*` environment variable when omitted.

## Properties

### publicKey?

> `optional` **publicKey?**: `string`

Project public key; defaults to `LANGFUSE_PUBLIC_KEY`.

---

### secretKey?

> `optional` **secretKey?**: `string`

Project secret key; defaults to `LANGFUSE_SECRET_KEY`.

---

### baseUrl?

> `optional` **baseUrl?**: `string`

Langfuse host; defaults to `LANGFUSE_BASE_URL`, then Langfuse Cloud.

---

### environment?

> `optional` **environment?**: `string`

Environment name; defaults to `LANGFUSE_TRACING_ENVIRONMENT`.

---

### release?

> `optional` **release?**: `string`

Release identifier; defaults to `LANGFUSE_RELEASE`.

---

### mask?

> `optional` **mask?**: (`params`) => [`JsonValue`](JsonValue.md)

Applied to input, output and metadata before they leave the process.

#### Parameters

##### params

###### data

[`JsonValue`](JsonValue.md)

#### Returns

[`JsonValue`](JsonValue.md)

---

### exportMode?

> `optional` **exportMode?**: `"batched"` \| `"immediate"`

`"immediate"` sends every span as it ends; `"batched"` (default) queues them.

---

### flushAt?

> `optional` **flushAt?**: `number`

Spans queued before a batch is sent; defaults to 15.

---

### flushInterval?

> `optional` **flushInterval?**: `number`

Seconds between batch sends; defaults to 5.
