import { SpanStatus } from "../types/index.js";

/** @description Langfuse OTLP ingestion endpoint path. */
export const TRACES_PATH = "/api/public/otel/v1/traces";

/** @description Langfuse health endpoint path. */
export const HEALTH_PATH = "/api/public/health";

/** @description Langfuse Cloud base URL used when none is configured. */
export const DEFAULT_BASE_URL = "https://cloud.langfuse.com";

/** @description Spans buffered before an automatic flush. */
export const DEFAULT_FLUSH_AT = 15;

/** @description Milliseconds between scheduled flushes. */
export const DEFAULT_FLUSH_INTERVAL_MS = 5_000;

/** @description Milliseconds before an export request is aborted. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** @description Maximum spans sent in one export request. */
export const MAX_SPANS_PER_REQUEST = 500;

/** @description Maximum serialized bytes sent in one export request. */
export const MAX_BYTES_PER_REQUEST = 3_500_000;

/** @description Placeholder that replaces a value fully removed by the user's mask. */
export const FULLY_MASKED = "<fully masked>";

/** @description Span attributes holding trace and observation input or output, which the mask applies to. */
export const CONTENT_KEYS = new Set([
  "langfuse.observation.input",
  "langfuse.observation.output",
  "langfuse.trace.input",
  "langfuse.trace.output",
]);

/** @description Attribute prefixes whose values are metadata entries. */
export const METADATA_PREFIXES = [
  "langfuse.observation.metadata.",
  "langfuse.trace.metadata.",
];

/** @description OTLP numeric status code for each span status. */
export const OTLP_STATUS_CODES: Record<SpanStatus, number> = {
  [SpanStatus.UNSET]: 0,
  [SpanStatus.WARNING]: 0,
  [SpanStatus.OK]: 1,
  [SpanStatus.ERROR]: 2,
};
