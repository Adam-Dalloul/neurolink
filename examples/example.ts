import { NeuroLink } from "@juspay/neurolink";
import { randomUUID } from "crypto";

const neurolink = new NeuroLink({
  observability: {
    langfuse: {
      environment: process.env.PUBLIC_APP_ENVIRONMENT || "dev",
    },
  },
});

async function main(): Promise<void> {
  const result = await neurolink.stream({
    input: { text: "meow" },
    provider: "azure",
    maxTokens: 1000,
    temperature: 0.7,
    context: {
      userId: "kitty",
      sessionId: randomUUID(),
      tags: ["example"],
      traceName: "kitty",
      metadata: { merchantId: "falafel" },
    },
  });

  for await (const chunk of result.stream) {
    if ("content" in chunk && chunk.content) {
      process.stdout.write(chunk.content);
    }
  }

  await neurolink.shutdown();
}

main().catch(console.error);
