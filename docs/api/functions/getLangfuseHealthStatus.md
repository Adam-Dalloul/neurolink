[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / getLangfuseHealthStatus

# Function: getLangfuseHealthStatus()

> **getLangfuseHealthStatus**(): `object`

## Returns

`object`

`isHealthy` and `hasProcessor` are `true` only while a Langfuse exporter is registered, on NeuroLink's own provider or beside a host provider (where it still needs `createExporterSpanProcessor()` on the host provider to receive spans); `error` carries the message of a failed initialization.

### isHealthy

> **isHealthy**: `boolean`

### initialized

> **initialized**: `boolean`

### hasProcessor

> **hasProcessor**: `boolean`

### usingExternalProvider

> **usingExternalProvider**: `boolean`

### error?

> `optional` **error?**: `string`

## Description

Summarizes the Langfuse export state for health checks.
