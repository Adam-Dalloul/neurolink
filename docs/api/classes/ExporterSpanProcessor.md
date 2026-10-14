[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / ExporterSpanProcessor

# Class: ExporterSpanProcessor

## Description

OpenTelemetry span processor that turns every observation span into `SpanData` and hands it to an `ExporterRegistry`, so one instrumentation feeds Langfuse, Datadog, Sentry and every other registered exporter. Spans that are not observations are skipped and their children are re-parented onto the nearest exported ancestor. Delivery never blocks the span's thread.

## Implements

- `SpanProcessor`

## Constructors

### Constructor

> **new ExporterSpanProcessor**(`registry`): `ExporterSpanProcessor`

#### Parameters

##### registry

[`ExporterRegistry`](ExporterRegistry.md)

{ExporterRegistry} - Registry that receives every exported span.

#### Returns

`ExporterSpanProcessor`

#### Description

Creates a processor bound to a registry.

## Methods

### onStart()

> **onStart**(`span`, `parentContext`): `void`

#### Parameters

##### span

`Span`

{Span} - Span that just started.

##### parentContext

`Context`

{Context} - Context the span was started in.

#### Returns

`void`

Nothing.

#### Description

Copies the propagated Langfuse trace attributes (user, session, trace name, tags, metadata) from the parent context onto the new span and remembers it until it ends.

#### Implementation of

`OtelSpanProcessor.onStart`

---

### onEnd()

> **onEnd**(`span`): `void`

#### Parameters

##### span

`ReadableSpan`

{ReadableSpan} - Span that just ended.

#### Returns

`void`

Nothing.

#### Description

Exports an ended observation span without waiting for the exporters.

#### Implementation of

`OtelSpanProcessor.onEnd`

---

### forceFlush()

> **forceFlush**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

Resolves when all exporters have flushed.

#### Description

Flushes every exporter in the registry.

#### Implementation of

`OtelSpanProcessor.forceFlush`

---

### shutdown()

> **shutdown**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

Resolves when all exporters have shut down.

#### Description

Shuts down every exporter in the registry.

#### Implementation of

`OtelSpanProcessor.shutdown`
