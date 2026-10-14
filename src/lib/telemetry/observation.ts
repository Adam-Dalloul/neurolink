import {
  createObservationAttributes,
  createTraceAttributes,
  LangfuseOtelSpanAttributes,
} from "@langfuse/tracing";
import type { Span } from "@opentelemetry/api";
import { WARNING_FINISH_REASONS } from "../constants/telemetry.js";
import type {
  GenerationRecord,
  ObservationAttributes,
  ObservationLevel,
  ObservationType,
  RawUsageObject,
  TraceContent,
} from "../types/index.js";
import { calculateCost } from "../utils/pricing.js";
import { extractTokenUsage } from "../utils/tokenUtils.js";
import {
  ATTR,
  spanContentAttribute,
  spanModelRequestAttribute,
} from "./attributes.js";
import { assistantMessages } from "./chatMessages.js";

function redactedIO<T extends Pick<TraceContent, "input" | "output">>(
  attrs: T,
): T {
  return {
    ...attrs,
    ...(attrs.input !== undefined && {
      input: spanContentAttribute(attrs.input),
    }),
    ...(attrs.output !== undefined && {
      output: spanContentAttribute(attrs.output),
    }),
  };
}

/**
 * @description Stamps Langfuse observation attributes on a span, plus a `gen_ai.observation.type` marker so the exporter pipeline recognizes it whatever its tracer scope. Input and output are credential-masked and capped at `SPAN_ATTRIBUTE_MAX_CHARS` before serialization.
 * @param span {Span} - Span to describe.
 * @param type {ObservationType} - Observation type Langfuse renders the span as.
 * @param attrs {ObservationAttributes} - Input, output, model, parameters, usage, cost, level and metadata to record.
 * @returns {void} Nothing.
 */
export function observe(
  span: Span,
  type: ObservationType,
  attrs: ObservationAttributes,
): void {
  span.setAttributes({
    ...createObservationAttributes(type, redactedIO(attrs)),
    [ATTR.GEN_AI_OBSERVATION]: type,
  });
}

/**
 * @description Sets the trace-level input, output and metadata on a span, credential-masked and capped like `observe`. Each metadata entry is written as its own `langfuse.trace.metadata.<key>` attribute, redacted like input and output.
 * @param span {Span} - Span whose trace is described.
 * @param io {TraceContent} - Trace input, output and metadata.
 * @returns {void} Nothing.
 */
export function observeTrace(span: Span, io: TraceContent): void {
  const { metadata, ...content } = io;
  span.setAttributes(createTraceAttributes(redactedIO(content)));
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (value !== undefined) {
      span.setAttribute(
        `${LangfuseOtelSpanAttributes.TRACE_METADATA}.${key}`,
        spanContentAttribute(value),
      );
    }
  }
}

/**
 * @description Maps any provider's token usage onto Langfuse usage-detail keys.
 * @param usage {RawUsageObject | undefined | null} - Token usage in any naming convention NeuroLink normalizes.
 * @returns {Record<string, number>} `input`, `output` and `total`, plus `cache_read_input_tokens`, `cache_creation_input_tokens` and `reasoning` when reported.
 */
export function usageDetails(
  usage: RawUsageObject | undefined | null,
): Record<string, number> {
  const tokens = extractTokenUsage(usage, { calculateCacheSavings: false });
  const details: Record<string, number> = {
    input: tokens.input,
    output: tokens.output,
    total: tokens.total,
  };
  if (tokens.cacheReadTokens !== undefined) {
    details.cache_read_input_tokens = tokens.cacheReadTokens;
  }
  if (tokens.cacheCreationTokens !== undefined) {
    details.cache_creation_input_tokens = tokens.cacheCreationTokens;
  }
  if (tokens.reasoning !== undefined) {
    details.reasoning = tokens.reasoning;
  }
  return details;
}

/**
 * @description Picks the Langfuse level for a model call that finished without throwing.
 * @param finishReason {string | undefined} - Provider finish reason, in any casing.
 * @param aborted {boolean | undefined} - Whether the caller aborted or closed the call early.
 * @returns {ObservationLevel | undefined} `"WARNING"` for truncated, filtered, aborted or empty output, otherwise `undefined`.
 */
export function observationLevel(
  finishReason?: string,
  aborted?: boolean,
): ObservationLevel | undefined {
  if (
    aborted ||
    WARNING_FINISH_REASONS.has(finishReason?.toLowerCase() ?? "")
  ) {
    return "WARNING";
  }
  return undefined;
}

/**
 * @description Records a model request on its span as a Langfuse generation: model, defined parameters, input, output, usage, cost and level. Safe to call once with the request and again with the response; unset fields leave earlier values in place.
 * @param span {Span} - Span of one model request.
 * @param call {GenerationRecord} - What was sent and what came back.
 * @returns {void} Nothing.
 */
export function observeGeneration(span: Span, call: GenerationRecord): void {
  const parameters: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(call.modelParameters ?? {})) {
    if (value !== undefined) {
      parameters[key] = value;
    }
  }
  const pricedModel = call.model ?? call.responseModel;
  const cost =
    call.usage && call.provider && pricedModel
      ? calculateCost(
          call.provider,
          pricedModel,
          extractTokenUsage(call.usage, { calculateCacheSavings: false }),
        )
      : 0;
  observe(span, "generation", {
    model: call.responseModel ?? call.model,
    modelParameters:
      Object.keys(parameters).length > 0 ? parameters : undefined,
    input:
      call.input === undefined
        ? undefined
        : spanModelRequestAttribute(call.input),
    output: assistantMessages(call.output),
    usageDetails: call.usage ? usageDetails(call.usage) : undefined,
    costDetails: cost > 0 ? { total: cost } : undefined,
    completionStartTime: call.completionStartTime,
    level: observationLevel(call.finishReason, call.aborted),
    metadata: call.provider ? { provider: call.provider } : undefined,
  });
}
