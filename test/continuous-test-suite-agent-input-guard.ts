#!/usr/bin/env tsx
/**
 * Continuous Test Suite: the agent routes' attachment guard, end to end.
 *
 * `POST /api/agent/execute` and `/api/agent/stream` accept `input.images` and
 * `input.files` as strings, and the SDK resolves a string itself: an `http(s)`
 * URL is fetched (redirects followed, no address check) and anything else is
 * read from the local disk. A caller of a network server must not be able to
 * aim either at the server's own network or disk.
 *
 * Every case drives a surface this package ships (CLAUDE.md rule 15): the
 * public `createServer` + `registerAllRoutes` from `../dist/index.js`, mounted
 * on an in-process Hono adapter and driven through Hono's own `app.request()`
 * (no port, no network), with `NeuroLink` doing the generating. The provider is
 * OpenAI behind `installMockFetch` and a fake key, so what the provider was
 * actually sent is observable and nothing leaves the machine.
 *
 * URL cases that must be refused are checked two ways: the response is a 400,
 * and a TCP listener standing in for the "internal service" counts zero
 * connections. A control proves the listener does count a connection, so a zero
 * is a real negative.
 *
 * What this suite cannot reach: a *successful* https download, which needs a
 * publicly routable https host, and a redirect to a private address, which
 * needs the same. `safeDownload` itself (address pinning, redirect refusal,
 * size cap) is the shared helper the transcription route already relies on.
 *
 * Run: pnpm exec tsx test/continuous-test-suite-agent-input-guard.ts
 */
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer as createTcpServer } from "node:net";
import type { AddressInfo, Server as TcpServer } from "node:net";
import { basename, join } from "node:path";
import {
  assert,
  assertEqual,
  defineSuite,
  Skip,
  tempDir,
} from "./helpers/harness.js";
import { installMockFetch } from "./utils/mockFetch.js";
import { NeuroLink, createServer, registerAllRoutes } from "../dist/index.js";

const { test, runSuite } = defineSuite("Agent routes: attachment guard", {
  offline: true,
});

const SENTINEL = "SENTINEL-OUTSIDE-SECRET-4471";
const MAX_INPUT_BYTES = 4096;

// A syntactically valid 1x1 PNG, the same one the file-intake suite uses.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");

const ALLOWED_ROOT = tempDir("neurolink-agent-allowed-");
const OUTSIDE_ROOT = tempDir("neurolink-agent-outside-");
writeFileSync(join(ALLOWED_ROOT, "inside.png"), PNG_BYTES);
writeFileSync(
  join(ALLOWED_ROOT, "too-big.png"),
  Buffer.alloc(MAX_INPUT_BYTES + 1),
);
// A real PNG padded after IEND to exactly the limit: decoders ignore the tail,
// and the size check must let a file of exactly maxInputBytes through.
writeFileSync(
  join(ALLOWED_ROOT, "at-limit.png"),
  Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_INPUT_BYTES - PNG_BYTES.length)]),
);
writeFileSync(join(ALLOWED_ROOT, "unreadable.png"), PNG_BYTES);
chmodSync(join(ALLOWED_ROOT, "unreadable.png"), 0o000);
writeFileSync(join(OUTSIDE_ROOT, "secret.txt"), SENTINEL);
mkdirSync(join(ALLOWED_ROOT, "nested"));
symlinkSync(join(OUTSIDE_ROOT, "secret.txt"), join(ALLOWED_ROOT, "link.txt"));
const OUTSIDE_SECRET = join(OUTSIDE_ROOT, "secret.txt");

type HonoLike = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
};

async function buildApp(agent?: {
  allowedInputRoots?: string[];
  maxInputBytes?: number;
}): Promise<HonoLike> {
  const adapter = await createServer(
    new NeuroLink({ conversationMemory: { enabled: false } }),
    { framework: "hono", config: { port: 0, host: "127.0.0.1" } },
  );
  await adapter.initialize();
  registerAllRoutes(adapter, "/api", agent ? { agent } : undefined);
  return adapter.getFrameworkInstance() as HonoLike;
}

// The default server (no `agent` option) and one that names a root.
const locked = await buildApp();
const scoped = await buildApp({
  allowedInputRoots: [ALLOWED_ROOT],
  maxInputBytes: MAX_INPUT_BYTES,
});

type Reply = { status: number; text: string };

async function post(
  app: HonoLike,
  route: "execute" | "stream",
  input: unknown,
): Promise<Reply> {
  const res = await app.request(`/api/agent/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, provider: "openai", model: "gpt-4o-mini" }),
  });
  return { status: res.status, text: await res.text() };
}

/**
 * `execute` answers a refusal with its HTTP status. `stream` answers every
 * error, its own validation errors included, with a 200 event stream whose
 * first frame carries the error code; that is the route's existing convention.
 */
function assertRefused(
  route: "execute" | "stream",
  reply: Reply,
  status: number,
  code: string,
): void {
  if (route === "execute") {
    assertEqual(reply.status, status, "refused with the HTTP status");
    return;
  }
  assert(
    reply.text.includes(`"code":"${code}"`),
    "refused with an error frame carrying the code",
  );
}

function openAIResponse(): unknown {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "gpt-4o-mini",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "a tiny pixel" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  };
}

/** A fake key and a mocked OpenAI, with the provider's recorded requests. */
async function withMockedProvider<T>(
  fn: (providerCalls: () => string[]) => Promise<T>,
): Promise<T> {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalBase = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "test-fake-openai-credential-for-agent-guard";
  delete process.env.OPENAI_BASE_URL;
  const { unset, calls } = installMockFetch([
    {
      method: "POST",
      url: "api.openai.com/v1/chat/completions",
      respond: { status: 200, json: openAIResponse() },
    },
  ]);
  try {
    return await fn(() => calls.map((c) => c.bodyText));
  } finally {
    unset();
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
    if (originalBase !== undefined) {
      process.env.OPENAI_BASE_URL = originalBase;
    }
  }
}

/** A TCP listener that counts connections, standing in for an internal service. */
async function withInternalService<T>(
  fn: (port: number, connections: () => number) => Promise<T>,
): Promise<T> {
  let count = 0;
  const server: TcpServer = createTcpServer((socket) => {
    count += 1;
    socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(port, () => count);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

for (const field of ["images", "files"] as const) {
  for (const route of ["execute", "stream"] as const) {
    await test(`${route}: a local path in input.${field} is refused when the server names no allowed directory, and its content never comes back`, async () => {
      await withMockedProvider(async (providerCalls) => {
        const reply = await post(locked, route, {
          text: "read this",
          [field]: [OUTSIDE_SECRET],
        });
        assertRefused(route, reply, 403, "FORBIDDEN");
        assert(
          !reply.text.includes(SENTINEL),
          "the refusal does not carry the file's content",
        );
        assertEqual(providerCalls().length, 0, "nothing reached the provider");
      });
    });
  }
}

await test("stream: a URL naming an internal address is refused in the stream's error frame", async () => {
  await withMockedProvider(async (providerCalls) => {
    const reply = await post(locked, "stream", {
      text: "x",
      images: ["https://169.254.169.254/latest/meta-data/"],
    });
    assertRefused("stream", reply, 400, "VALIDATION_ERROR");
    assertEqual(providerCalls().length, 0, "nothing reached the provider");
  });
});

await test("a path that does not exist gets the same refusal as one that does, so the route is not an oracle for which files exist", async () => {
  await withMockedProvider(async () => {
    const present = await post(locked, "execute", {
      text: "x",
      images: [OUTSIDE_SECRET],
    });
    const absent = await post(locked, "execute", {
      text: "x",
      images: [join(OUTSIDE_ROOT, "no-such-file.png")],
    });
    assertEqual(absent.status, present.status, "same status either way");
    assertEqual(
      JSON.parse(absent.text).error.message,
      JSON.parse(present.text).error.message,
      "same message either way",
    );
  });
});

await test("with an allowed directory named: a path outside it, a `..` escape and a symlink out of it are all refused", async () => {
  await withMockedProvider(async (providerCalls) => {
    const attempts = [
      OUTSIDE_SECRET,
      join(ALLOWED_ROOT, "..", basename(OUTSIDE_ROOT), "secret.txt"),
      join(ALLOWED_ROOT, "link.txt"),
    ];
    for (const attempt of attempts) {
      const reply = await post(scoped, "execute", {
        text: "x",
        files: [attempt],
      });
      assertEqual(reply.status, 403, "an escape from the allowed directory");
      assert(
        !reply.text.includes(SENTINEL),
        "the refusal does not carry the file's content",
      );
    }
    assertEqual(providerCalls().length, 0, "nothing reached the provider");
  });
});

await test("with an allowed directory named: a file inside it is read by the server and reaches the provider unchanged", async () => {
  await withMockedProvider(async (providerCalls) => {
    const reply = await post(scoped, "execute", {
      text: "describe this image",
      images: [join(ALLOWED_ROOT, "inside.png")],
    });
    assertEqual(reply.status, 200, "an allowed path is served");
    const sent = providerCalls();
    assert(
      sent.length > 0,
      "the provider was called (control for the zeros above)",
    );
    assert(
      sent.some((body) => body.includes(PNG_BASE64)),
      "the provider received the file's bytes",
    );
  });
});

await test("a file over maxInputBytes is refused with 413, and a directory is refused too", async () => {
  await withMockedProvider(async () => {
    const big = await post(scoped, "execute", {
      text: "x",
      images: [join(ALLOWED_ROOT, "too-big.png")],
    });
    assertEqual(big.status, 413, "oversize attachment");
    const dir = await post(scoped, "execute", {
      text: "x",
      images: [join(ALLOWED_ROOT, "nested")],
    });
    assertEqual(dir.status, 400, "a directory is not an attachment");
  });
});

await test("a file of exactly maxInputBytes is served", async () => {
  await withMockedProvider(async (providerCalls) => {
    const reply = await post(scoped, "execute", {
      text: "describe this image",
      images: [join(ALLOWED_ROOT, "at-limit.png")],
    });
    assertEqual(reply.status, 200, "the limit is inclusive");
    assert(providerCalls().length > 0, "the provider was called");
  });
});

await test("a file inside the root that the server cannot read is refused with 403, not a server error", async () => {
  // Running as root reads the file regardless, so the case cannot fail there.
  let readable = true;
  try {
    readFileSync(join(ALLOWED_ROOT, "unreadable.png"));
  } catch {
    readable = false;
  }
  if (readable) {
    throw new Skip("this process can read a mode-000 file (running as root)");
  }
  await withMockedProvider(async (providerCalls) => {
    const reply = await post(scoped, "execute", {
      text: "x",
      images: [join(ALLOWED_ROOT, "unreadable.png")],
    });
    assertEqual(reply.status, 403, "refused, and not a 500");
    assertEqual(providerCalls().length, 0, "nothing reached the provider");
  });
});

await test("a data: URI still works on a default server (the path callers already use is unchanged)", async () => {
  await withMockedProvider(async (providerCalls) => {
    const reply = await post(locked, "execute", {
      text: "describe this image",
      images: [`data:image/png;base64,${PNG_BASE64}`],
    });
    assertEqual(reply.status, 200, "data URI accepted");
    assert(
      providerCalls().some((body) => body.includes(PNG_BASE64)),
      "the provider received the image",
    );
  });
});

await test("a plain-text request is unchanged", async () => {
  await withMockedProvider(async (providerCalls) => {
    const reply = await post(locked, "execute", "hello");
    assertEqual(reply.status, 200, "plain string input");
    assert(providerCalls().length > 0, "the provider was called");
  });
});

await test("URLs that name an internal address are refused before any connection is made", async () => {
  await withInternalService(async (port, connections) => {
    await withMockedProvider(async (providerCalls) => {
      const targets = [
        `http://127.0.0.1:${port}/a.png`,
        `https://127.0.0.1:${port}/a.png`,
        `https://localhost:${port}/a.png`,
        `https://[::1]:${port}/a.png`,
        `https://2130706433:${port}/a.png`,
        `https://0x7f.0.0.1:${port}/a.png`,
        "https://169.254.169.254/latest/meta-data/",
        "https://[::ffff:169.254.169.254]/latest/meta-data/",
      ];
      for (const field of ["images", "files"] as const) {
        for (const url of targets) {
          const reply = await post(locked, "execute", {
            text: "x",
            [field]: [url],
          });
          assertEqual(reply.status, 400, `internal URL in input.${field}`);
        }
      }
      assertEqual(connections(), 0, "the internal service saw no connection");
      assertEqual(providerCalls().length, 0, "nothing reached the provider");
    });
  });
});

await test("control: the internal-service listener does count a connection that is made", async () => {
  await withInternalService(async (port, connections) => {
    const { connect } = await import("node:net");
    await new Promise<void>((resolve) => {
      const socket = connect(port, "127.0.0.1", () => socket.end());
      socket.on("close", () => resolve());
    });
    // The server counts on 'connection', which fires just after the client's.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assertEqual(connections(), 1, "the listener counts connections");
  });
});

await test("unsupported schemes and case variants are refused, not guessed at", async () => {
  await withMockedProvider(async () => {
    const entries = [
      "file:///etc/passwd",
      "ftp://example.com/a.png",
      "DATA:image/png;base64,AAAA",
      "gopher://example.com/",
    ];
    for (const entry of entries) {
      const reply = await post(locked, "execute", {
        text: "x",
        images: [entry],
      });
      assertEqual(reply.status, 400, "a scheme the server does not resolve");
    }
    const spaced = await post(locked, "execute", {
      text: "x",
      images: [" https://127.0.0.1/a.png"],
    });
    assertEqual(
      spaced.status,
      403,
      "a padded URL is treated as a path, and refused",
    );
  });
});

await runSuite();
