[**NeuroLink API Reference**](../README.md)

---

[NeuroLink API Reference](../README.md) / ObservabilityConfig

# Type Alias: ObservabilityConfig

> **ObservabilityConfig** = `object`

## Description

Observability configuration for the NeuroLink SDK. Langfuse turns on automatically when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set; `false` turns it off.

## Properties

### langfuse?

> `optional` **langfuse?**: `boolean` \| [`NeurolinkLangfuseConfig`](NeurolinkLangfuseConfig.md)

`false` disables Langfuse, `true` or an options object enables it.
