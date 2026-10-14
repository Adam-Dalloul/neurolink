/**
 * Agent request attachments, vetted at the HTTP boundary.
 *
 * `input.images` and `input.files` reach the SDK as strings, and the SDK
 * resolves a string itself: an `http(s)` URL is fetched with redirects followed
 * and no address check, and anything else is read from the local disk. Both
 * are right for a program that names its own files. Neither is right when the
 * string came from a caller of a network server, who could name
 * `https://169.254.169.254/...`, a redirect to it, or `/etc/passwd`.
 *
 * So the route resolves every attachment itself and hands the SDK bytes:
 *   - `data:` URIs pass through, they carry their own content;
 *   - `https` URLs are downloaded with `safeDownload` (the address is checked
 *     and then pinned, redirects are refused, the size is capped);
 *   - local paths are read only from the operator's `allowedInputRoots`, after
 *     symlinks are resolved;
 *   - everything else is refused rather than guessed at, so this classifier
 *     can never disagree with the SDK's about what a string means.
 *
 * The SDK itself is untouched: a program calling `generate()` directly keeps
 * reading the paths and URLs it names.
 *
 * @module server/utils/agentInput
 */

import fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import type {
  ServerAgentResolvedInput,
  ServerAgentRouteOptions,
} from "../../types/index.js";
import { logger } from "../../utils/logger.js";

const DEFAULT_MAX_INPUT_BYTES = 50 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

/** Two or more scheme characters, so a Windows drive letter (`C:\`) is not one. */
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

/** An attachment the server refuses, with the HTTP status that says why. */
export class AgentInputError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "AgentInputError";
  }
}

const isUnder = (child: string, root: string): boolean =>
  child === root ||
  child.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

const forbidden = (): AgentInputError =>
  new AgentInputError(
    "attachment path is outside the directories this server allows (or local paths are disabled)",
    403,
    "FORBIDDEN",
  );

/**
 * A file under one of the allowed roots, after symlinks are resolved.
 *
 * A path outside every root is refused before the file system is touched, so
 * the answer for `/etc/passwd` and for `/etc/nothing-here` is the same 403 and
 * the route is not an oracle for which files exist.
 */
async function readAllowedPath(
  requested: string,
  roots: string[] | undefined,
  limit: number,
): Promise<Buffer> {
  if (!roots || roots.length === 0) {
    throw forbidden();
  }
  const lexical = path.resolve(requested);
  const realRoots = (
    await Promise.all(
      roots.map(async (root) => {
        try {
          return [path.resolve(root), await fs.promises.realpath(root)];
        } catch {
          return [];
        }
      }),
    )
  ).flat();
  if (!realRoots.some((root) => isUnder(lexical, root))) {
    throw forbidden();
  }
  let real: string;
  try {
    real = await fs.promises.realpath(lexical);
  } catch {
    throw new AgentInputError(
      "attachment path does not exist",
      404,
      "NOT_FOUND",
    );
  }
  if (!realRoots.some((root) => isUnder(real, root))) {
    throw forbidden();
  }
  // Open once and judge the descriptor, not the path: a path can be swapped for
  // a symlink between the checks above and a later read. O_NOFOLLOW refuses a
  // symlink in the last component; a directory swapped higher up is not caught,
  // which matters only if something untrusted can write under an allowed root.
  let handle: FileHandle;
  try {
    handle = await fs.promises.open(
      real,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch (error) {
    throw unreadable(error);
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new AgentInputError(
        "attachment path is not a file",
        400,
        "VALIDATION_ERROR",
      );
    }
    if (stat.size > limit) {
      throw tooLarge(limit);
    }
    return await readWithinLimit(handle, limit);
  } finally {
    await handle.close();
  }
}

const tooLarge = (limit: number): AgentInputError =>
  new AgentInputError(
    `attachment exceeds the ${limit}-byte limit`,
    413,
    "PAYLOAD_TOO_LARGE",
  );

/** A failed open of a path that passed the checks: a race or a permission, not a server fault. */
function unreadable(error: unknown): unknown {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOENT") {
    return new AgentInputError(
      "attachment path does not exist",
      404,
      "NOT_FOUND",
    );
  }
  if (code === "EACCES" || code === "EPERM" || code === "ELOOP") {
    return new AgentInputError(
      "attachment path is not readable",
      403,
      "FORBIDDEN",
    );
  }
  return error;
}

/**
 * Read the whole file, refusing one that outgrew `limit` since it was measured:
 * reads one byte past the limit, so growth is seen rather than buffered.
 */
async function readWithinLimit(
  handle: FileHandle,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= limit) {
    const chunk = Buffer.allocUnsafe(
      Math.min(READ_CHUNK_BYTES, limit + 1 - total),
    );
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, total);
    if (bytesRead === 0) {
      break;
    }
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total > limit) {
    throw tooLarge(limit);
  }
  return Buffer.concat(chunks, total);
}

async function downloadAttachment(url: string, limit: number): Promise<Buffer> {
  // Dynamic import keeps undici off the static import graph; see
  // test/continuous-test-suite-import-cost.ts.
  const { safeDownload } = await import("../../utils/safeFetch.js");
  try {
    return await safeDownload(url, {
      maxBytes: limit,
      label: "agent attachment",
    });
  } catch (error) {
    // The reason can name the address a host resolved to; the caller gets none
    // of it, the operator gets it in the log.
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn("[agentInput] refused an attachment URL", {
      reason: reason.replaceAll(url, "<url>"),
    });
    throw new AgentInputError(
      "attachment URL could not be fetched (it must be a public https URL, answer without a redirect and fit the size limit)",
      400,
      "VALIDATION_ERROR",
    );
  }
}

async function resolveAttachment(
  entry: string,
  roots: string[] | undefined,
  limit: number,
): Promise<Buffer | string> {
  // Exactly the prefix the SDK keys on, so nothing that reaches it as a string
  // is anything but a data URI.
  if (entry.startsWith("data:")) {
    return entry;
  }
  if (/^https?:\/\//i.test(entry)) {
    return downloadAttachment(entry, limit);
  }
  if (URL_SCHEME.test(entry)) {
    throw new AgentInputError(
      "attachment must be a data: URI, an https URL, or a path under an allowed directory",
      400,
      "VALIDATION_ERROR",
    );
  }
  return readAllowedPath(entry, roots, limit);
}

async function resolveAttachments(
  entries: string[] | undefined,
  roots: string[] | undefined,
  limit: number,
): Promise<Array<Buffer | string> | undefined> {
  if (entries === undefined) {
    return undefined;
  }
  // One at a time: a request naming many URLs must not open them all at once.
  const resolved: Array<Buffer | string> = [];
  for (const entry of entries) {
    resolved.push(await resolveAttachment(entry, roots, limit));
  }
  return resolved;
}

/**
 * Replace every attachment of an agent request's `input` with vetted content.
 *
 * @throws {AgentInputError} for the first attachment that is refused.
 */
export async function resolveAgentInput(
  input: { text: string; images?: string[]; files?: string[] },
  options?: ServerAgentRouteOptions,
): Promise<ServerAgentResolvedInput> {
  const limit = options?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const roots = options?.allowedInputRoots;
  const images = await resolveAttachments(input.images, roots, limit);
  const files = await resolveAttachments(input.files, roots, limit);
  return {
    text: input.text,
    ...(images ? { images } : {}),
    ...(files ? { files } : {}),
  };
}
