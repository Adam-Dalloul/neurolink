import {
  MAX_BYTES_PER_REQUEST,
  MAX_SPANS_PER_REQUEST,
  OTLP_STATUS_CODES,
} from "../constants/langfuse.js";
import type {
  LangfuseAttributePolicy,
  OtlpAnyValue,
  OtlpKeyValue,
  OtlpSpan,
  SpanAttributes,
  SpanAttributeValue,
  SpanData,
} from "../types/index.js";
import { SpanStatus } from "../types/index.js";
import { protectAttributes } from "./langfuseMasking.js";

const SPAN_KIND_INTERNAL = 1;

function toNanos(iso: string): string {
  return (BigInt(Date.parse(iso)) * 1_000_000n).toString();
}

function toOtlpValue(value: SpanAttributeValue): OtlpAnyValue {
  if (typeof value === "boolean") {
    return { boolValue: value };
  }
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toOtlpValue) } };
  }
  return { stringValue: String(value) };
}

/**
 * @description Encodes attributes as OTLP/JSON key-values, dropping `undefined` and `null` entries.
 * @param attributes {SpanAttributes} - Attribute record to encode.
 * @returns {OtlpKeyValue[]} One typed key-value per kept attribute.
 */
export function toOtlpAttributes(attributes: SpanAttributes): OtlpKeyValue[] {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({ key, value: toOtlpValue(value) }));
}

/**
 * @description Encodes one span as OTLP/JSON, applying the exporter's attribute policy to its attributes.
 * @param span {SpanData} - Span to encode.
 * @param policy {LangfuseAttributePolicy} - Environment, release, redaction and mask settings.
 * @returns {OtlpSpan} The span in the shape Langfuse's ingestion endpoint reads.
 */
export function toOtlpSpan(
  span: SpanData,
  policy: LangfuseAttributePolicy,
): OtlpSpan {
  const failed = span.status === SpanStatus.ERROR;
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId && { parentSpanId: span.parentSpanId }),
    name: span.name,
    kind: SPAN_KIND_INTERNAL,
    startTimeUnixNano: toNanos(span.startTime),
    endTimeUnixNano: toNanos(span.endTime ?? span.startTime),
    attributes: toOtlpAttributes(protectAttributes(span.attributes, policy)),
    events: span.events.map((event) => ({
      name: event.name,
      timeUnixNano: toNanos(event.timestamp),
      attributes: toOtlpAttributes(event.attributes ?? {}),
    })),
    status: {
      code: OTLP_STATUS_CODES[span.status],
      ...(failed && span.statusMessage && { message: span.statusMessage }),
    },
  };
}

/**
 * @description Splits encoded spans into request-sized batches, bounded by span count and serialized bytes.
 * @param spans {OtlpSpan[]} - Encoded spans, in export order.
 * @returns {OtlpSpan[][]} Batches that each fit one export request; a single oversized span still gets its own batch.
 */
export function chunkOtlpSpans(spans: OtlpSpan[]): OtlpSpan[][] {
  const chunks: OtlpSpan[][] = [];
  let current: OtlpSpan[] = [];
  let bytes = 0;
  for (const span of spans) {
    const size = Buffer.byteLength(JSON.stringify(span));
    if (
      current.length > 0 &&
      (current.length >= MAX_SPANS_PER_REQUEST ||
        bytes + size > MAX_BYTES_PER_REQUEST)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(span);
    bytes += size;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}
