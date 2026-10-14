import type { GenerationOperation } from "../types/index.js";
import { activeOperation } from "./tracers.js";

/**
 * @description Names a model-call observation after the public API the caller used.
 * @param operation {GenerationOperation | undefined} - Explicit operation; inferred from the active span's ancestry when unset.
 * @returns {string} `generate` or `stream`; `generate` when the operation cannot be inferred.
 */
export function generationName(operation?: GenerationOperation): string {
  return operation ?? activeOperation() ?? "generate";
}

/**
 * @description Names a tool observation after the tool, as the model sees it.
 * @param toolName {string} - Tool name.
 * @returns {string} The observation name, which is the bare tool name.
 */
export function toolSpanName(toolName: string): string {
  return toolName;
}

/**
 * @description Names one agentic loop step. The one-based index travels as `step_index` metadata so every step of every run aggregates under the same name.
 * @returns {string} The observation name, `step`.
 */
export function stepSpanName(): string {
  return "step";
}
