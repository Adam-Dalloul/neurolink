[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / flushOpenTelemetry

# Function: flushOpenTelemetry()

> **flushOpenTelemetry**(): `Promise`\<`void`\>

## Returns

`Promise`\<`void`\>

Resolves when every owned provider has flushed.

## Description

Exports pending spans and metrics from the providers NeuroLink owns and flushes its Langfuse exporter. A host provider is never flushed.

## Throws

When any provider fails to flush.
