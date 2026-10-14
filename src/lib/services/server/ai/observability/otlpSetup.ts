import { metrics } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { Resource } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTEL_LOG_PREFIX } from "../../../../constants/telemetry.js";
import { logger } from "../../../../utils/logger.js";

/**
 * @description Builds a batching span processor that ships spans to an OTLP/HTTP endpoint.
 * @param endpoint {string} - OTLP base URL; `/v1/traces` is appended.
 * @returns {SpanProcessor | null} The processor, or `null` (after a warning) when the exporter cannot be created.
 */
export function createOtlpSpanProcessor(
  endpoint: string,
): SpanProcessor | null {
  try {
    return new BatchSpanProcessor(
      new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      {
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 1000,
        exportTimeoutMillis: 30000,
      },
    );
  } catch (error) {
    logger.warn(`${OTEL_LOG_PREFIX} Failed to create OTLP trace exporter`, {
      error: error instanceof Error ? error.message : String(error),
      endpoint,
    });
    return null;
  }
}

/**
 * @description Builds a meter provider that exports metrics to an OTLP/HTTP endpoint and registers it as the global meter provider.
 * @param endpoint {string} - OTLP base URL; `/v1/metrics` is appended.
 * @param resource {Resource} - Resource describing the service.
 * @returns {MeterProvider | null} The provider, or `null` (after a warning) when it cannot be created.
 */
export function createOtlpMeterProvider(
  endpoint: string,
  resource: Resource,
): MeterProvider | null {
  try {
    const provider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
          exportIntervalMillis: 15000,
          exportTimeoutMillis: 10000,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(provider);
    return provider;
  } catch (error) {
    logger.warn(`${OTEL_LOG_PREFIX} Failed to create OTLP metric exporter`, {
      error: error instanceof Error ? error.message : String(error),
      endpoint,
    });
    return null;
  }
}
