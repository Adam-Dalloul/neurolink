[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / shutdownOpenTelemetry

# Function: shutdownOpenTelemetry()

> **shutdownOpenTelemetry**(): `Promise`\<`void`\>

## Returns

`Promise`\<`void`\>

Resolves when telemetry is flushed or shut down.

## Description

Terminally shuts down the providers NeuroLink owns once no `acquireTelemetry` holder remains; while holders remain it only flushes. Telemetry cannot be restarted in this process afterwards. A host provider is never shut down; with one, only NeuroLink's Langfuse exporter is shut down and unregistered.
