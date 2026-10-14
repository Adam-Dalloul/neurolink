#!/usr/bin/env node

/**
 * NeuroLink Observability with Langfuse Example
 *
 * This example demonstrates:
 * - Automatic Langfuse tracing from LANGFUSE_* environment variables
 * - Passing trace identity (userId, sessionId, tags, etc.) via per-call `context`
 * - Using `setLangfuseContext()` to wrap code that calls generate indirectly
 * - Reusing a host-registered OpenTelemetry provider with `LangfuseSpanProcessor`
 *   or with `createExporterSpanProcessor()` (exporter pipeline)
 *
 * Langfuse (https://langfuse.com) provides LLM observability including:
 * - Trace visualization for every AI call
 * - Token usage tracking and cost analytics
 * - Latency monitoring across providers
 * - Custom metadata and session grouping
 *
 * Usage:
 *   npx tsx examples/observability-langfuse.ts
 *
 * Prerequisites:
 *   - Langfuse account and project (cloud.langfuse.com or self-hosted)
 *   - export LANGFUSE_PUBLIC_KEY="pk-..."
 *   - export LANGFUSE_SECRET_KEY="sk-..."
 *   - Optional: LANGFUSE_BASE_URL, LANGFUSE_TRACING_ENVIRONMENT, LANGFUSE_RELEASE
 *   - At least one AI provider API key set
 */

import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  createExporterSpanProcessor,
  ExporterRegistry,
  flushOpenTelemetry,
  getLangfuseHealthStatus,
  LangfuseExporter,
  NeuroLink,
  setLangfuseContext,
} from "@juspay/neurolink";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

async function observabilityLangfuseExample() {
  console.log("NeuroLink Observability with Langfuse Example\n");

  const tracingEnabled =
    !!process.env.LANGFUSE_PUBLIC_KEY && !!process.env.LANGFUSE_SECRET_KEY;

  if (!tracingEnabled) {
    console.log(
      "Langfuse credentials not found. Set these environment variables:",
    );
    console.log('  export LANGFUSE_PUBLIC_KEY="pk-..."');
    console.log('  export LANGFUSE_SECRET_KEY="sk-..."');
    console.log(
      "\nRunning without tracing (nothing will be sent to Langfuse).\n",
    );
  }

  console.log(
    "1. Creating NeuroLink (tracing starts from the environment)...\n",
  );

  const neurolink = new NeuroLink();

  try {
    console.log("2. Generating with per-call context...\n");

    const result = await neurolink.generate({
      input: { text: "What are the benefits of LLM observability?" },
      maxTokens: 300,
      context: {
        userId: "user-alice-123",
        sessionId: "session-demo-456",
        conversationId: "conv-789",
        traceName: "observability-example",
        tags: ["example", "observability"],
        metadata: {
          environment: "development",
          feature: "observability-demo",
          version: "1.0.0",
        },
      },
    });

    console.log(`AI: ${result.content}\n`);
    console.log(`Provider: ${result.provider ?? "default"}`);
    console.log(`Tokens: ${result.usage?.totalTokens ?? "unknown"}`);

    console.log("\n3. Wrapping indirect calls with setLangfuseContext...\n");

    await setLangfuseContext(
      {
        userId: "user-alice-123",
        sessionId: "session-demo-456",
        traceName: "follow-up-question",
      },
      async () => {
        const followUp = await neurolink.generate({
          input: {
            text: "How do you set up distributed tracing for AI applications?",
          },
          maxTokens: 200,
        });
        console.log(`AI: ${followUp.content}\n`);
        console.log(`Tokens: ${followUp.usage?.totalTokens ?? "unknown"}`);
      },
    );

    console.log("\n4. What you will see in Langfuse:\n");
    console.log(
      "   - Each generate() call creates a trace in the Langfuse dashboard",
    );
    console.log("   - Traces are grouped by sessionId ('session-demo-456')");
    console.log(
      "   - Each trace shows: userId, tags, input, output, token usage, latency",
    );
    console.log(
      "   - Custom metadata (environment, feature) appears on the trace",
    );
    console.log(
      "   - The traceName ('observability-example') is the trace display name",
    );
    console.log(
      "   - Cost tracking is automatic based on model and token counts",
    );

    if (tracingEnabled) {
      console.log("\n   View your traces at: https://cloud.langfuse.com");
    }
  } catch (error) {
    const err = error as Error;
    console.error("Error:", err.message);

    if (err.message.includes("API key")) {
      console.log("\nSetup help:");
      console.log('export GOOGLE_AI_API_KEY="AIza-your-key"');
      console.log("Or:");
      console.log('export OPENAI_API_KEY="sk-your-key"');
    }
  }

  await flushOpenTelemetry();
  await neurolink.shutdown();
  console.log("\nDone!");
}

async function externalProviderExample() {
  const provider = new NodeTracerProvider({
    spanProcessors: [new LangfuseSpanProcessor()],
  });
  provider.register();

  const neurolink = new NeuroLink();
  console.log(
    `Using external provider: ${getLangfuseHealthStatus().usingExternalProvider}`,
  );

  const result = await neurolink.generate({
    input: { text: "Hello from a host-managed tracer provider" },
    context: { traceName: "external-provider" },
  });
  console.log(`AI: ${result.content}`);

  await provider.forceFlush();
  await neurolink.shutdown();
}

async function exporterPipelineExample() {
  const langfuse = new LangfuseExporter({
    enabled: true,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? "",
    secretKey: process.env.LANGFUSE_SECRET_KEY ?? "",
    baseUrl: process.env.LANGFUSE_BASE_URL,
  });
  await langfuse.initialize();
  const registry = new ExporterRegistry();
  registry.register(langfuse);

  const provider = new NodeTracerProvider({
    spanProcessors: [createExporterSpanProcessor(registry)],
  });
  provider.register();

  const neurolink = new NeuroLink();
  const result = await neurolink.generate({
    input: { text: "Hello through the exporter pipeline" },
    context: { traceName: "exporter-pipeline" },
  });
  console.log(`AI: ${result.content}`);

  await provider.forceFlush();
  await neurolink.shutdown();
}

import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  observabilityLangfuseExample().catch(console.error);
}

export {
  exporterPipelineExample,
  externalProviderExample,
  observabilityLangfuseExample,
};
