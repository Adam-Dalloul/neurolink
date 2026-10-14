[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / createExporterSpanProcessor

# Function: createExporterSpanProcessor()

> **createExporterSpanProcessor**(`registry?`): [`ExporterSpanProcessor`](../classes/ExporterSpanProcessor.md)

## Parameters

### registry?

[`ExporterRegistry`](../classes/ExporterRegistry.md) = `...`

{ExporterRegistry} - Registry to export to; defaults to the process-wide registry.

## Returns

[`ExporterSpanProcessor`](../classes/ExporterSpanProcessor.md)

A processor ready to be added to a TracerProvider.

## Description

Creates a span processor that feeds NeuroLink's observation spans to an exporter registry. Add it to a host `TracerProvider` to deliver spans through the registered exporters (such as `LangfuseExporter`) instead of `LangfuseSpanProcessor`.

## Example

```ts
const provider = new NodeTracerProvider({
  spanProcessors: [createExporterSpanProcessor()],
});
```
