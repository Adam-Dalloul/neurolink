[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / GenerationRecord

# Type Alias: GenerationRecord

> **GenerationRecord** = `object`

## Description

One model request as a Langfuse generation. Every field is optional so the request half and the response half can be recorded separately.

## Properties

### operation?

> `optional` **operation?**: [`GenerationOperation`](GenerationOperation.md)

Public API the call serves; inferred from the enclosing span when unset.

---

### provider?

> `optional` **provider?**: `string`

Provider name, used with the model to price the call.

---

### model?

> `optional` **model?**: `string`

Model the request asked for.

---

### responseModel?

> `optional` **responseModel?**: `string`

Model the response says served it, when the API reports one.

---

### modelParameters?

> `optional` **modelParameters?**: `Record`\<`string`, `string` \| `number` \| `undefined`\>

Sampling and thinking parameters sent; undefined entries are dropped.

---

### input?

> `optional` **input?**: [`SpanModelRequest`](SpanModelRequest.md)

System prompt and messages, or the bare prompt, sent.

---

### output?

> `optional` **output?**: [`AssistantOutput`](AssistantOutput.md)

Text and tool calls returned.

---

### usage?

> `optional` **usage?**: [`RawUsageObject`](RawUsageObject.md) \| `null`

Token usage in any naming convention `extractTokenUsage` reads.

---

### finishReason?

> `optional` **finishReason?**: `string`

Provider finish reason.

---

### aborted?

> `optional` **aborted?**: `boolean`

Whether the caller aborted the call before it finished.

---

### completionStartTime?

> `optional` **completionStartTime?**: `Date`

When the first chunk of a streamed response arrived.
