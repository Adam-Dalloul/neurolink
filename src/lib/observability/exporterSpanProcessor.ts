import { getPropagatedAttributesFromContext } from "@langfuse/core";
import { type Context, SpanStatusCode } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanProcessor as OtelSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { MAX_REMEMBERED_SPANS } from "../constants/telemetry.js";
import type { SpanData } from "../types/index.js";
import { SpanStatus, SpanType } from "../types/index.js";
import { logger } from "../utils/logger.js";
import type { ExporterRegistry } from "./exporterRegistry.js";
import { getExporterRegistry } from "./exporterRegistry.js";

const LANGFUSE_OBSERVATION_TYPE = "langfuse.observation.type";
const GEN_AI_OBSERVATION_TYPE = "gen_ai.observation.type";
const GEN_AI_OPERATION = "gen_ai.operation.name";

const OBSERVATION_SPAN_TYPES: Record<string, SpanType> = {
  agent: SpanType.AGENT_RUN,
  tool: SpanType.TOOL_CALL,
  chain: SpanType.WORKFLOW_STEP,
  retriever: SpanType.RETRIEVAL,
  evaluator: SpanType.EVALUATION,
  embedding: SpanType.EMBEDDING,
};

function isObservation(span: ReadableSpan): boolean {
  return (
    span.attributes[LANGFUSE_OBSERVATION_TYPE] !== undefined ||
    span.attributes[GEN_AI_OBSERVATION_TYPE] !== undefined ||
    Object.keys(span.attributes).some((key) => key.startsWith("gen_ai."))
  );
}

function spanTypeOf(span: ReadableSpan): SpanType {
  const observationType = String(
    span.attributes[LANGFUSE_OBSERVATION_TYPE] ?? "",
  ).toLowerCase();
  if (observationType === "generation") {
    return span.attributes[GEN_AI_OPERATION] === "decide"
      ? SpanType.MODEL_DECISION
      : SpanType.MODEL_GENERATION;
  }
  return OBSERVATION_SPAN_TYPES[observationType] ?? SpanType.CUSTOM;
}

const STATUS_BY_CODE: Record<SpanStatusCode, SpanStatus> = {
  [SpanStatusCode.UNSET]: SpanStatus.UNSET,
  [SpanStatusCode.OK]: SpanStatus.OK,
  [SpanStatusCode.ERROR]: SpanStatus.ERROR,
};

function toMillis(time: ReadableSpan["startTime"]): number {
  return time[0] * 1_000 + time[1] / 1_000_000;
}

function toIso(time: ReadableSpan["startTime"]): string {
  return new Date(toMillis(time)).toISOString();
}

function toSpanData(span: ReadableSpan, parentSpanId?: string): SpanData {
  const { traceId, spanId } = span.spanContext();
  return {
    spanId,
    traceId,
    ...(parentSpanId && { parentSpanId }),
    type: spanTypeOf(span),
    name: span.name,
    startTime: toIso(span.startTime),
    endTime: toIso(span.endTime),
    durationMs: toMillis(span.duration),
    status: STATUS_BY_CODE[span.status.code],
    ...(span.status.message && { statusMessage: span.status.message }),
    attributes: { ...span.attributes },
    events: span.events.map((event) => ({
      name: event.name,
      timestamp: toIso(event.time),
      ...(event.attributes && { attributes: { ...event.attributes } }),
    })),
    links: span.links.map((link) => ({
      traceId: link.context.traceId,
      spanId: link.context.spanId,
      ...(link.attributes && { attributes: { ...link.attributes } }),
    })),
  };
}

/**
 * @description OpenTelemetry span processor that turns every observation span into `SpanData` and hands it to an `ExporterRegistry`, so one instrumentation feeds Langfuse, Datadog, Sentry and every other registered exporter. Spans that are not observations are skipped and their children are re-parented onto the nearest exported ancestor. Delivery never blocks the span's thread.
 */
export class ExporterSpanProcessor implements OtelSpanProcessor {
  private readonly open = new Map<string, ReadableSpan>();
  private readonly ended = new Map<
    string,
    { parentSpanId?: string; observation: boolean }
  >();

  /**
   * @description Creates a processor bound to a registry.
   * @param registry {ExporterRegistry} - Registry that receives every exported span.
   */
  constructor(private readonly registry: ExporterRegistry) {}

  /**
   * @description Copies the propagated Langfuse trace attributes (user, session, trace name, tags, metadata) from the parent context onto the new span and remembers it until it ends.
   * @param span {Span} - Span that just started.
   * @param parentContext {Context} - Context the span was started in.
   * @returns {void} Nothing.
   */
  onStart(span: Span, parentContext: Context): void {
    span.setAttributes(getPropagatedAttributesFromContext(parentContext));
    this.open.set(span.spanContext().spanId, span);
    if (this.open.size > MAX_REMEMBERED_SPANS) {
      const oldest = this.open.keys().next().value;
      if (oldest !== undefined) {
        this.open.delete(oldest);
      }
    }
  }

  /**
   * @description Exports an ended observation span without waiting for the exporters.
   * @param span {ReadableSpan} - Span that just ended.
   * @returns {void} Nothing.
   */
  onEnd(span: ReadableSpan): void {
    const { spanId } = span.spanContext();
    this.open.delete(spanId);
    const observation = isObservation(span);
    this.remember(spanId, span.parentSpanContext?.spanId, observation);
    if (!observation) {
      return;
    }
    const spanData = toSpanData(span, this.nearestExportedAncestor(span));
    void this.exportQuietly(spanData);
  }

  /**
   * @description Flushes every exporter in the registry.
   * @returns {Promise<void>} Resolves when all exporters have flushed.
   */
  forceFlush(): Promise<void> {
    return this.registry.flushAll();
  }

  /**
   * @description Shuts down every exporter in the registry.
   * @returns {Promise<void>} Resolves when all exporters have shut down.
   */
  shutdown(): Promise<void> {
    return this.registry.shutdownAll();
  }

  private async exportQuietly(spanData: SpanData): Promise<void> {
    try {
      await this.registry.exportToAll(spanData);
    } catch (error) {
      logger.debug("[ExporterSpanProcessor] Export failed", {
        spanId: spanData.spanId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private remember(
    spanId: string,
    parentSpanId: string | undefined,
    observation: boolean,
  ): void {
    this.ended.set(spanId, { parentSpanId, observation });
    if (this.ended.size > MAX_REMEMBERED_SPANS) {
      const oldest = this.ended.keys().next().value;
      if (oldest !== undefined) {
        this.ended.delete(oldest);
      }
    }
  }

  private nearestExportedAncestor(span: ReadableSpan): string | undefined {
    let candidate = span.parentSpanContext?.spanId;
    while (candidate) {
      const live = this.open.get(candidate);
      if (live) {
        if (isObservation(live)) {
          return candidate;
        }
        candidate = live.parentSpanContext?.spanId;
        continue;
      }
      const finished = this.ended.get(candidate);
      if (!finished) {
        return undefined;
      }
      if (finished.observation) {
        return candidate;
      }
      candidate = finished.parentSpanId;
    }
    return undefined;
  }
}

/**
 * @description Creates a span processor that feeds NeuroLink's observation spans to an exporter registry. Add it to a host `TracerProvider` to deliver spans through the registered exporters (such as `LangfuseExporter`) instead of `LangfuseSpanProcessor`.
 * @param registry {ExporterRegistry} - Registry to export to; defaults to the process-wide registry.
 * @returns {ExporterSpanProcessor} A processor ready to be added to a TracerProvider.
 * @example
 * const provider = new NodeTracerProvider({ spanProcessors: [createExporterSpanProcessor()] });
 */
export function createExporterSpanProcessor(
  registry: ExporterRegistry = getExporterRegistry(),
): ExporterSpanProcessor {
  return new ExporterSpanProcessor(registry);
}
