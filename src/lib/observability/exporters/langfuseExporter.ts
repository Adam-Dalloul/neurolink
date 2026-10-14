import {
  DEFAULT_BASE_URL,
  DEFAULT_FLUSH_AT,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  HEALTH_PATH,
  TRACES_PATH,
} from "../../constants/langfuse.js";
import type {
  ExporterHealthStatus,
  ExportResult,
  LangfuseAttributePolicy,
  LangfuseExporterConfig,
  OtlpSpan,
  SpanData,
} from "../../types/index.js";
import { logger } from "../../utils/logger.js";
import {
  chunkOtlpSpans,
  toOtlpAttributes,
  toOtlpSpan,
} from "../otlpEncoding.js";
import { BaseExporter } from "./baseExporter.js";

let credentialsWarned = false;

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * @description Exporter that delivers observation spans to Langfuse's OTLP/HTTP JSON endpoint (`POST /api/public/otel/v1/traces`), which keeps native observation types and identity on every observation. Spans are queued without blocking and sent in batches; failed requests are retried with backoff when the failure is transient (429, 5xx, network).
 */
export class LangfuseExporter extends BaseExporter {
  private readonly authorization: string;
  private readonly baseUrl: string;
  private readonly policy: LangfuseAttributePolicy;
  private readonly inflight = new Set<Promise<void>>();

  /**
   * @description Creates an exporter for one Langfuse project.
   * @param config {LangfuseExporterConfig} - Credentials, endpoint, environment, release, masking and batching options. `environment` and `release` fall back to `LANGFUSE_TRACING_ENVIRONMENT` and `LANGFUSE_RELEASE`, and only fill spans that do not carry them already.
   */
  constructor(private readonly langfuse: LangfuseExporterConfig) {
    super("langfuse", {
      ...langfuse,
      maxBufferSize: langfuse.maxBufferSize ?? DEFAULT_FLUSH_AT,
    });
    this.authorization = `Basic ${Buffer.from(
      `${langfuse.publicKey}:${langfuse.secretKey}`,
    ).toString("base64")}`;
    this.baseUrl = (langfuse.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.policy = {
      environment:
        langfuse.environment ?? process.env.LANGFUSE_TRACING_ENVIRONMENT,
      release: langfuse.release ?? process.env.LANGFUSE_RELEASE,
      redactIO: langfuse.redactIO ?? false,
      mask: langfuse.mask,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (!this.langfuse.publicKey || !this.langfuse.secretKey) {
      throw new Error("Langfuse publicKey and secretKey are required");
    }
    this.initialized = true;
    this.startFlushInterval(
      this.config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    );
    this.flushInterval?.unref();
  }

  async exportSpan(span: SpanData): Promise<ExportResult> {
    this.bufferSpan(span);
    return this.createSuccessResult(1, 0);
  }

  async exportBatch(spans: SpanData[]): Promise<ExportResult> {
    const startTime = Date.now();
    await this.deliver(spans.map((span) => toOtlpSpan(span, this.policy)));
    return this.createSuccessResult(spans.length, Date.now() - startTime);
  }

  async flush(): Promise<void> {
    const spans = this.buffer;
    this.buffer = [];
    if (spans.length > 0) {
      const pending = this.exportQuietly(spans);
      this.inflight.add(pending);
      void pending.finally(() => this.inflight.delete(pending));
    }
    await Promise.all(this.inflight);
  }

  private async exportQuietly(spans: SpanData[]): Promise<void> {
    try {
      await this.exportBatch(spans);
    } catch (error) {
      logger.warn("[langfuse] Export failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async shutdown(): Promise<void> {
    await this.flush();
    this.stopFlushInterval();
    this.initialized = false;
  }

  async healthCheck(): Promise<ExporterHealthStatus> {
    try {
      await this.withRetry(() => this.ping(), "health check");
      return this.createHealthStatus(true);
    } catch {
      return this.createHealthStatus(false, ["Health check failed"]);
    }
  }

  protected async ping(): Promise<void> {
    const response = await fetch(`${this.baseUrl}${HEALTH_PATH}`, {
      headers: { Authorization: this.authorization },
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Langfuse API unreachable: ${response.status}`);
    }
  }

  private async deliver(spans: OtlpSpan[]): Promise<void> {
    for (const chunk of chunkOtlpSpans(spans)) {
      try {
        await this.withRetry(() => this.post(chunk), "export");
      } catch (error) {
        logger.warn(`[langfuse] Dropped ${chunk.length} spans`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async post(spans: OtlpSpan[]): Promise<void> {
    const response = await fetch(`${this.baseUrl}${TRACES_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authorization,
        "x-langfuse-sdk-name": "javascript",
        "x-langfuse-ingestion-version": "4",
        "x-langfuse-public-key": this.langfuse.publicKey,
      },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: {
              attributes: toOtlpAttributes({ "service.name": "service" }),
            },
            scopeSpans: [{ scope: { name: "sdk" }, spans }],
          },
        ],
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      if (!credentialsWarned) {
        credentialsWarned = true;
        logger.warn("[langfuse] Langfuse credentials rejected");
      }
      return;
    }
    if (isRetryable(response.status)) {
      throw new Error(`Langfuse API error: ${response.status}`);
    }
    if (!response.ok) {
      logger.warn(`[langfuse] Export rejected with ${response.status}`);
      return;
    }
    const body = (await response.json().catch(() => ({}))) as {
      partialSuccess?: {
        rejectedSpans?: number | string;
        errorMessage?: string;
      };
    };
    const rejected = Number(body.partialSuccess?.rejectedSpans ?? 0);
    if (rejected > 0) {
      logger.warn(`[langfuse] ${rejected} spans rejected`, {
        message: body.partialSuccess?.errorMessage,
      });
    }
  }
}
