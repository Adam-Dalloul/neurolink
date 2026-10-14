[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / AssistantToolCall

# Type Alias: AssistantToolCall

> **AssistantToolCall** = `object`

## Description

A tool call as a provider, the agentic loop or a tool execution names its fields.

## Properties

### id?

> `optional` **id?**: `string`

---

### toolCallId?

> `optional` **toolCallId?**: `string`

---

### name?

> `optional` **name?**: `string`

---

### toolName?

> `optional` **toolName?**: `string`

---

### args?

> `optional` **args?**: [`SpanContent`](SpanContent.md)

---

### input?

> `optional` **input?**: [`SpanContent`](SpanContent.md)

---

### arguments?

> `optional` **arguments?**: [`SpanContent`](SpanContent.md)

---

### function?

> `optional` **function?**: `object`

#### name?

> `optional` **name?**: `string`

#### arguments?

> `optional` **arguments?**: [`SpanContent`](SpanContent.md)
