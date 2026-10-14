import {
  propagateAttributes,
  setLangfuseTracerProvider,
} from "@langfuse/tracing";
import {
  context,
  createContextKey,
  metrics,
  ProxyTracerProvider,
  trace,
  type Context,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { MeterProvider } from "@opentelemetry/sdk-metrics";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  OTEL_LOG_PREFIX,
  TRACE_METADATA_CONTEXT_KEY,
} from "../../../../constants/telemetry.js";
import { getExporterRegistry } from "../../../../observability/exporterRegistry.js";
import { ExporterSpanProcessor } from "../../../../observability/exporterSpanProcessor.js";
import { LangfuseExporter } from "../../../../observability/exporters/langfuseExporter.js";
import { spanJsonAttribute } from "../../../../telemetry/attributes.js";
import type {
  NeurolinkTraceContext,
  ObservabilityConfig,
  SpanContent,
} from "../../../../types/index.js";
import { logger } from "../../../../utils/logger.js";
import { createLangfuseExporter, isLangfuseEnabled } from "./langfuseSetup.js";
import {
  createOtlpMeterProvider,
  createOtlpSpanProcessor,
} from "./otlpSetup.js";

const MAX_PROPAGATED_CHARS = 200;
const LANGFUSE_EXPORTER_NAME = "langfuse";
const TRACE_METADATA_KEY = createContextKey(TRACE_METADATA_CONTEXT_KEY);

let tracerProvider: NodeTracerProvider | null = null;
let meterProvider: MeterProvider | null = null;
let langfuseExporter: LangfuseExporter | null = null;
let usingExternalProvider = false;
let started = false;
let initialized = false;
let ignoredConfigLogged = false;
let initializationError: string | null = null;
let terminated = false;
let terminationLogged = false;
let unconfiguredLogged = false;
let holders = 0;

function hasHostTracerProvider(): boolean {
  const global = trace.getTracerProvider();
  if (!(global instanceof ProxyTracerProvider)) {
    return true;
  }
  return global.getDelegateTracer("ai") !== undefined;
}

function registerLangfuseExporter(
  config?: ObservabilityConfig,
): LangfuseExporter | null {
  const registry = getExporterRegistry();
  const existing = registry.get(LANGFUSE_EXPORTER_NAME);
  if (existing) {
    return existing instanceof LangfuseExporter ? existing : null;
  }
  const exporter = createLangfuseExporter(config);
  if (exporter) {
    registry.register(exporter);
  }
  return exporter;
}

function initialize(config?: ObservabilityConfig): boolean {
  const langfuse = isLangfuseEnabled(config);
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!langfuse && !otlpEndpoint) {
    if (!unconfiguredLogged) {
      unconfiguredLogged = true;
      logger.debug(
        `${OTEL_LOG_PREFIX} Langfuse and OTLP not configured; skipping`,
      );
    }
    return config?.langfuse === false;
  }

  if (hasHostTracerProvider()) {
    usingExternalProvider = true;
    initialized = true;
    langfuseExporter = langfuse ? registerLangfuseExporter(config) : null;
    if (langfuseExporter) {
      logger.info(
        `${OTEL_LOG_PREFIX} Host TracerProvider detected; Langfuse exporter registered. Add \`createExporterSpanProcessor()\` to the host provider to export NeuroLink spans to it.`,
      );
    } else {
      logger.info(
        `${OTEL_LOG_PREFIX} Host TracerProvider detected; NeuroLink registers no provider and no exporter.`,
      );
    }
    return true;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "ai-service",
  });

  const exporter = langfuse ? registerLangfuseExporter(config) : null;
  const otlpProcessor = otlpEndpoint
    ? createOtlpSpanProcessor(otlpEndpoint)
    : null;
  const spanProcessors: SpanProcessor[] = [
    new ExporterSpanProcessor(getExporterRegistry()),
  ];
  if (otlpProcessor) {
    spanProcessors.push(otlpProcessor);
  }

  const provider = new NodeTracerProvider({ resource, spanProcessors });
  provider.register({ propagator: new W3CTraceContextPropagator() });
  setLangfuseTracerProvider(provider);

  tracerProvider = provider;
  langfuseExporter = exporter;
  meterProvider = otlpEndpoint
    ? createOtlpMeterProvider(otlpEndpoint, resource)
    : null;
  usingExternalProvider = false;
  initialized = true;

  logger.info(`${OTEL_LOG_PREFIX} Observability initialized`, {
    langfuseEnabled: exporter !== null,
    otlpEnabled: otlpProcessor !== null,
  });
  return true;
}

async function stop(): Promise<void> {
  const provider = tracerProvider;
  const meters = meterProvider;
  const hostExporter = usingExternalProvider ? langfuseExporter : null;
  terminated = true;
  tracerProvider = null;
  meterProvider = null;
  langfuseExporter = null;
  usingExternalProvider = false;
  started = false;
  initialized = false;
  initializationError = null;
  if (provider) {
    setLangfuseTracerProvider(null);
  }
  if (meters) {
    metrics.disable();
  }
  if (hostExporter) {
    getExporterRegistry().unregister(hostExporter.getName());
  }
  const results = await Promise.allSettled([
    provider?.shutdown(),
    hostExporter?.shutdown(),
    meters?.shutdown(),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      logger.error(`${OTEL_LOG_PREFIX} Shutdown failed`, {
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  }
}

/**
 * @description Starts NeuroLink's tracing once per process, synchronously. Every span created through the shared tracers calls it first, so direct provider calls without a NeuroLink instance are traced too. Langfuse is enabled unless `config.langfuse` is `false`, when an options object is given or `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set; an OTLP exporter is added when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. When the host already registered a TracerProvider no provider is created; the Langfuse exporter, if configured, is registered on the shared exporter registry and the host adds `createExporterSpanProcessor()` to its provider. The first call that finds tracing configured decides the setup and a later `config` is ignored; calls made before anything is configured start nothing, so a later config or environment can still start tracing, unless `langfuse: false` was passed. After `shutdownOpenTelemetry` it does nothing.
 * @param config {ObservabilityConfig | undefined} - Observability options, honoured only when this is the first call.
 * @returns {void} Nothing; a failed setup is logged and recorded in `getLangfuseHealthStatus`.
 */
export function ensureTelemetry(config?: ObservabilityConfig): void {
  if (terminated) {
    if (!terminationLogged) {
      terminationLogged = true;
      logger.debug(
        `${OTEL_LOG_PREFIX} Telemetry was shut down for this process; not restarting`,
      );
    }
    return;
  }
  if (started) {
    if (config && !ignoredConfigLogged) {
      ignoredConfigLogged = true;
      logger.debug(
        `${OTEL_LOG_PREFIX} Telemetry already started; ignoring observability config`,
      );
    }
    return;
  }
  initializationError = null;
  try {
    started = initialize(config);
  } catch (error) {
    started = true;
    initializationError =
      error instanceof Error ? error.message : String(error);
    logger.error(`${OTEL_LOG_PREFIX} Initialization failed`, {
      error: initializationError,
    });
  }
}

/**
 * @description Registers a holder of the process-wide telemetry and starts it if needed. Pair every call with `releaseTelemetry`.
 * @param config {ObservabilityConfig | undefined} - Observability options forwarded to `ensureTelemetry`.
 * @returns {void} Nothing.
 */
export function acquireTelemetry(config?: ObservabilityConfig): void {
  holders++;
  ensureTelemetry(config);
}

/**
 * @description Releases one holder registered by `acquireTelemetry` and flushes pending spans. The provider stays registered for the process so cached tracers keep working and later instances reuse it.
 * @returns {Promise<void>} Resolves when pending spans are flushed.
 * @throws {Error} When any provider fails to flush.
 */
export async function releaseTelemetry(): Promise<void> {
  holders = Math.max(0, holders - 1);
  await flushOpenTelemetry();
}

/**
 * @description Exports pending spans and metrics from the providers NeuroLink owns and flushes its Langfuse exporter. A host provider is never flushed.
 * @returns {Promise<void>} Resolves when every owned provider has flushed.
 * @throws {Error} When any provider fails to flush.
 */
export async function flushOpenTelemetry(): Promise<void> {
  const results = await Promise.allSettled([
    tracerProvider?.forceFlush(),
    usingExternalProvider ? langfuseExporter?.flush() : undefined,
    meterProvider?.forceFlush(),
  ]);
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length > 0) {
    throw new Error(`${OTEL_LOG_PREFIX} Flush failed`, {
      cause: failed.map((result) => result.reason),
    });
  }
}

/**
 * @description Terminally shuts down the providers NeuroLink owns once no `acquireTelemetry` holder remains; while holders remain it only flushes. Telemetry cannot be restarted in this process afterwards. A host provider is never shut down; with one, only NeuroLink's Langfuse exporter is shut down and unregistered.
 * @returns {Promise<void>} Resolves when telemetry is flushed or shut down.
 */
export async function shutdownOpenTelemetry(): Promise<void> {
  if (holders > 0) {
    await flushOpenTelemetry();
    return;
  }
  await stop();
}

/**
 * @description Reports whether NeuroLink's tracing is active, either on its own provider or alongside a host provider.
 * @returns {boolean} `true` once `ensureTelemetry` has set tracing up.
 */
export function isOpenTelemetryInitialized(): boolean {
  return initialized;
}

/**
 * @description Summarizes the Langfuse export state for health checks.
 * @returns {{ isHealthy: boolean; initialized: boolean; hasProcessor: boolean; usingExternalProvider: boolean; error?: string }} `isHealthy` and `hasProcessor` are `true` only while a Langfuse exporter is registered, on NeuroLink's own provider or beside a host provider (where it still needs `createExporterSpanProcessor()` on the host provider to receive spans); `error` carries the message of a failed initialization.
 */
export function getLangfuseHealthStatus(): {
  isHealthy: boolean;
  initialized: boolean;
  hasProcessor: boolean;
  usingExternalProvider: boolean;
  error?: string;
} {
  return {
    isHealthy: initialized && langfuseExporter !== null,
    initialized,
    hasProcessor: langfuseExporter !== null,
    usingExternalProvider,
    ...(initializationError !== null && { error: initializationError }),
  };
}

/**
 * @description Reads the full trace metadata that `setLangfuseContext` stored on a context.
 * @param ctx {Context} - Context to read, normally the active one.
 * @returns {Record<string, SpanContent>} Metadata set by enclosing `setLangfuseContext` calls, inner keys winning; empty when none was set.
 */
export function traceMetadataFromContext(
  ctx: Context,
): Record<string, SpanContent> {
  const stored = ctx.getValue(TRACE_METADATA_KEY);
  return stored && typeof stored === "object"
    ? (stored as Record<string, SpanContent>)
    : {};
}

/**
 * @description Runs `fn` with trace attributes propagated to every span it creates. `conversationId` and `requestId` become metadata; empty values are dropped. Metadata values of up to 200 characters once stringified are on every observation; longer values and arrays are recorded in full on the trace only, written by the trace root.
 * @param params {NeurolinkTraceContext} - User, session, trace name, tags and metadata for the trace.
 * @param fn {() => T} - Work to run inside the propagated context.
 * @returns {T} Whatever `fn` returns.
 * @example
 * await setLangfuseContext({ userId: "u1", sessionId: "s1" }, () => neurolink.generate({ input: { text: "hi" } }));
 */
export function setLangfuseContext<T>(
  params: NeurolinkTraceContext,
  fn: () => T,
): T {
  const full: Record<string, SpanContent> = {};
  const propagated: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    ...params.metadata,
    conversationId: params.conversationId,
    requestId: params.requestId,
  })) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    full[key] = value;
    const text = spanJsonAttribute(value, Number.POSITIVE_INFINITY);
    if (text.length <= MAX_PROPAGATED_CHARS) {
      propagated[key] = text;
    }
  }
  const tags = params.tags?.filter((tag) => tag.length > 0);
  const active = context.active();
  const withMetadata = active.setValue(TRACE_METADATA_KEY, {
    ...traceMetadataFromContext(active),
    ...full,
  });
  return context.with(withMetadata, () =>
    propagateAttributes(
      {
        userId: params.userId || undefined,
        sessionId: params.sessionId || undefined,
        traceName: params.traceName || undefined,
        ...(tags && tags.length > 0 && { tags }),
        ...(Object.keys(propagated).length > 0 && { metadata: propagated }),
      },
      fn,
    ),
  );
}
