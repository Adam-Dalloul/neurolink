import {
  TRUNCATION_NOTE_ALLOWANCE_CHARS,
  UNSERIALIZABLE_VALUE,
} from "../constants/telemetry.js";

function safeString<T>(value: T): string {
  try {
    return String(value);
  } catch {
    return UNSERIALIZABLE_VALUE;
  }
}

/**
 * @description Serializes a value for a span attribute: strings pass through, everything else is JSON, with a `String()` fallback for circular structures and `[unserializable]` when even that throws.
 * @param value {T} - Value to serialize.
 * @returns {string} The serialized value; never throws.
 */
export function stringify<T>(value: T): string {
  try {
    return typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? safeString(value));
  } catch {
    return safeString(value);
  }
}

/**
 * @description Cuts every string inside a structure down to a per-string character budget, in place, leaving a truncation note on each cut string. Only call it on a copy the caller owns.
 * @param node {T} - String or structure to shorten.
 * @param budget {number} - Maximum characters kept per string, note included.
 * @returns {T | string} The shortened string, or the same structure after its strings were cut.
 */
export function capStrings<T>(node: T, budget: number): T | string {
  if (typeof node === "string") {
    if (node.length <= budget) {
      return node;
    }
    const keep = Math.max(0, budget - TRUNCATION_NOTE_ALLOWANCE_CHARS);
    return `${node.slice(0, keep)}...[truncated ${node.length - keep} chars]`;
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  for (const [key, entry] of Object.entries(node)) {
    Reflect.set(node, key, capStrings(entry, budget));
  }
  return node;
}
