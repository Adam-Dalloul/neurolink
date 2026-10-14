[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / TraceContent

# Type Alias: TraceContent

> **TraceContent** = `Pick`\<[`ObservationAttributes`](ObservationAttributes.md), `"input"` \| `"output"`\> & `object`

## Type Declaration

### metadata?

> `optional` **metadata?**: `Record`\<`string`, [`SpanContent`](SpanContent.md) \| `undefined`\>

## Description

Trace-level input, output and per-key metadata recorded by `observeTrace`.
