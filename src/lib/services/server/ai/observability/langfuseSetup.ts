import { OTEL_LOG_PREFIX } from "../../../../constants/telemetry.js";
import { LangfuseExporter } from "../../../../observability/exporters/langfuseExporter.js";
import type { ObservabilityConfig } from "../../../../types/index.js";
import { logger } from "../../../../utils/logger.js";

async function initializeQuietly(exporter: LangfuseExporter): Promise<void> {
  try {
    await exporter.initialize();
  } catch (error) {
    logger.warn(`${OTEL_LOG_PREFIX} Langfuse exporter failed to initialize`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * @description Decides whether Langfuse export is on: off when `config.langfuse` is `false`, on when it is an options object or both Langfuse keys are in the environment.
 * @param config {ObservabilityConfig | undefined} - Observability options.
 * @returns {boolean} `true` when a Langfuse exporter should be created.
 */
export function isLangfuseEnabled(config?: ObservabilityConfig): boolean {
  const langfuse = config?.langfuse;
  if (langfuse === false) {
    return false;
  }
  return (
    typeof langfuse === "object" ||
    Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY)
  );
}

/**
 * @description Builds and starts a Langfuse exporter from config, falling back to the `LANGFUSE_*` environment variables.
 * @param config {ObservabilityConfig | undefined} - Observability options; `langfuse` may carry keys, base URL, environment, release, mask and batching.
 * @returns {LangfuseExporter | null} The exporter, or `null` (after a warning) when the public or secret key is missing.
 */
export function createLangfuseExporter(
  config?: ObservabilityConfig,
): LangfuseExporter | null {
  const options = typeof config?.langfuse === "object" ? config.langfuse : {};
  const publicKey = options.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = options.secretKey ?? process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    logger.warn(
      `${OTEL_LOG_PREFIX} Langfuse is enabled but publicKey and secretKey are not both set in config or LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY; not exporting to Langfuse`,
    );
    return null;
  }
  const exporter = new LangfuseExporter({
    enabled: true,
    publicKey,
    secretKey,
    baseUrl: options.baseUrl ?? process.env.LANGFUSE_BASE_URL,
    environment: options.environment,
    release: options.release,
    mask: options.mask,
    maxBufferSize: options.exportMode === "immediate" ? 1 : options.flushAt,
    flushIntervalMs:
      options.flushInterval === undefined
        ? undefined
        : options.flushInterval * 1000,
  });
  void initializeQuietly(exporter);
  return exporter;
}
