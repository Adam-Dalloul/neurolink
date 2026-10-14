import {
  BINARY_KEYS,
  BINARY_PAYLOAD_MIN_CHARS,
  REDACTED_VALUE,
} from "../constants/telemetry.js";
import type { JsonValue } from "../types/index.js";

const TOKEN_KEY_PATTERN = /tokens?$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/_\-=\s]+$/;
const MIME_TYPE_KEYS = ["mimeType", "mediaType", "media_type", "mime_type"];
const DATA_URL_PATTERN = new RegExp(
  `data:([\\w.+-]+/[\\w.+-]+)?(?:;[\\w=.+-]+)*;base64,[A-Za-z0-9+/_\\-=]{${BINARY_PAYLOAD_MIN_CHARS},}`,
  "g",
);
const ENV_SECRET_PATTERN =
  /\b([\w.-]*(?:api[_-]?key|secret|password|passwd|token|credential|private[_-]?key|signature)[\w.-]*)(\s*[=:]\s*)(?!\d+\b)[^\s&"',;]+/gi;
const BARE_SECRET_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})/g;

function normalizeKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

function maskStrings(value: JsonValue): JsonValue {
  if (typeof value === "string") {
    return REDACTED_VALUE;
  }
  if (Array.isArray(value)) {
    return value.map(maskStrings);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, maskStrings(entry)]),
  );
}

/**
 * @description Masks the value stored under a credential-looking key. Structures under a plural token key (`tokens`) keep their shape with every string masked; anything else collapses to the placeholder.
 * @param key {string} - Property name that matched the sensitive-key pattern.
 * @param entry {JsonValue} - Value stored under that key.
 * @returns {JsonValue} The masked value.
 */
export function redactSensitiveEntry(key: string, entry: JsonValue): JsonValue {
  const isStructure = typeof entry === "object" && entry !== null;
  return isStructure && TOKEN_KEY_PATTERN.test(normalizeKey(key))
    ? maskStrings(entry)
    : REDACTED_VALUE;
}

/**
 * @description Masks credentials written as `name=value`, `name: value` or as a recognizable bare key (OpenAI, GitHub, AWS, Slack). Purely numeric values after a credential-looking name are left alone.
 * @param text {string} - Text to scan.
 * @returns {string} The text with credential values replaced.
 */
export function redactSecretAssignments(text: string): string {
  return text
    .replace(
      ENV_SECRET_PATTERN,
      (_match, key: string, separator: string) =>
        `${key}${separator}${REDACTED_VALUE}`,
    )
    .replace(BARE_SECRET_PATTERN, REDACTED_VALUE);
}

/**
 * @description Replaces inline base64 data URLs with a size and MIME-type placeholder.
 * @param text {string} - Text to scan.
 * @returns {string} The text with each data URL payload replaced by `[N bytes mime/type]`.
 */
export function describeDataUrls(text: string): string {
  return text.replace(
    DATA_URL_PATTERN,
    (match, mimeType: string | undefined) =>
      `[${Math.floor(((match.length - match.indexOf(",") - 1) * 3) / 4)} bytes${mimeType ? ` ${mimeType}` : ""}]`,
  );
}

/**
 * @description Tells whether an object key conventionally holds a binary payload.
 * @param key {string} - Property name.
 * @returns {boolean} `true` for keys such as `data`, `image`, `bytes` and `base64`.
 */
export function isBinaryKey(key: string): boolean {
  return BINARY_KEYS.has(normalizeKey(key));
}

/**
 * @description Reads the MIME type an object declares for its payload.
 * @param node {object} - Object that may carry `mimeType`, `mediaType`, `media_type` or `mime_type`.
 * @returns {string | undefined} The declared MIME type, or `undefined` when none is a string.
 */
export function declaredMimeType(node: object): string | undefined {
  for (const key of MIME_TYPE_KEYS) {
    const declared = Reflect.get(node, key);
    if (typeof declared === "string") {
      return declared;
    }
  }
  return undefined;
}

/**
 * @description Describes a binary payload by size instead of content.
 * @param value {ArrayBuffer | ArrayBufferView | string} - Raw bytes, or a base64 string long enough to be treated as bytes.
 * @param mimeType {string | undefined} - MIME type to include in the placeholder.
 * @returns {string | undefined} `[N bytes mime/type]`, or `undefined` when the value is not binary.
 */
export function binaryPlaceholder(
  value: ArrayBuffer | ArrayBufferView | string,
  mimeType: string | undefined,
): string | undefined {
  const suffix = mimeType ? ` ${mimeType}` : "";
  if (typeof value !== "string") {
    return value instanceof ArrayBuffer || ArrayBuffer.isView(value)
      ? `[${value.byteLength} bytes${suffix}]`
      : undefined;
  }
  if (value.length > BINARY_PAYLOAD_MIN_CHARS && BASE64_PATTERN.test(value)) {
    return `[${Math.floor((value.length * 3) / 4)} bytes${suffix}]`;
  }
  return undefined;
}
