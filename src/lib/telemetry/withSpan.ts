import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import {
  context,
  type Span,
  SpanKind,
  type SpanStatus,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { GenerationRecord, SpanOptions } from "../types/index.js";
import { isAbortError } from "../utils/errorHandling.js";
import { observe, observeGeneration } from "./observation.js";
import { generationName, stepSpanName } from "./observationNames.js";
import { tracers } from "./tracers.js";

function markFailure(span: Span, error: unknown, expected = false): void {
  const message = error instanceof Error ? error.message : String(error);
  if (isAbortError(error)) {
    span.setAttributes({
      [LangfuseOtelSpanAttributes.OBSERVATION_LEVEL]: "WARNING",
      [LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE]: message,
    });
    return;
  }
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  if (!expected) {
    span.setAttributes({
      [LangfuseOtelSpanAttributes.OBSERVATION_LEVEL]: "ERROR",
      [LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE]: message,
    });
  }
  if (error instanceof Error) {
    span.recordException(error);
  }
}

export async function withSpan<T>(
  options: SpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const {
    name,
    tracer,
    kind = SpanKind.INTERNAL,
    attributes,
    detached,
  } = options;
  const run = async (span: Span): Promise<T> => {
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined) {
          span.setAttribute(key, value);
        }
      }
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      markFailure(span, error, options.expectedFailure?.(error));
      throw error;
    } finally {
      span.end();
    }
  };
  return detached
    ? run(tracer.startSpan(name, { kind }))
    : tracer.startActiveSpan(name, { kind }, run);
}

export async function withClientSpan<T>(
  options: Omit<SpanOptions, "kind">,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan({ ...options, kind: SpanKind.CLIENT }, fn);
}

/**
 * @description Wraps a streaming operation in a span that stays open until the consumer reaches end-of-stream, throws, or closes the iterable, so the span covers the whole stream rather than only its setup.
 * @param options {SpanOptions} - Span name, tracer, kind and initial attributes.
 * @param fn {(span: Span) => Promise<TResult>} - Produces the result; must not depend on the iterable being consumed before returning.
 * @param getIterable {(result: TResult) => AsyncIterable<TChunk>} - Selects the iterable to wrap out of the result.
 * @param setIterable {(result: TResult, wrapped: AsyncIterableIterator<TChunk>) => TResult} - Returns a new result carrying the wrapped iterable; must clone rather than mutate.
 * @returns {Promise<TResult>} The result with its iterable replaced by the span-lifetime-extending one.
 * @example
 * ```ts
 * return withStreamSpan(
 *   { name: "provider.stream", tracer, attributes: {...} },
 *   async () => this.executeStreamInner(options),
 *   (r) => r.stream,
 *   (r, wrapped) => ({ ...r, stream: wrapped }),
 * );
 * ```
 */
export async function withStreamSpan<TResult, TChunk>(
  options: SpanOptions,
  fn: (span: Span) => Promise<TResult>,
  getIterable: (result: TResult) => AsyncIterable<TChunk>,
  setIterable: (
    result: TResult,
    wrapped: AsyncIterableIterator<TChunk>,
  ) => TResult,
): Promise<TResult> {
  const {
    name,
    tracer,
    kind = SpanKind.CLIENT,
    attributes,
    detached,
  } = options;
  const span = tracer.startSpan(name, { kind });
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        span.setAttribute(key, value);
      }
    }
  }
  const spanContext = detached
    ? context.active()
    : trace.setSpan(context.active(), span);

  let result: TResult;
  try {
    result = await context.with(spanContext, () => fn(span));
  } catch (error) {
    markFailure(span, error);
    span.end();
    throw error;
  }

  const iterator = getIterable(result)[Symbol.asyncIterator]();
  let ended = false;
  let started = false;
  function end(status?: SpanStatus): void {
    if (ended) {
      return;
    }
    ended = true;
    if (status) {
      span.setStatus(status);
    }
    span.end();
  }
  async function close(): Promise<void> {
    if (ended) {
      return;
    }
    span.setAttributes({
      [LangfuseOtelSpanAttributes.OBSERVATION_LEVEL]: "WARNING",
      [LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE]: started
        ? "stream closed early"
        : "stream closed before first chunk",
    });
    end();
    await iterator.return?.();
  }

  const wrapped: AsyncIterableIterator<TChunk> = {
    async next(): Promise<IteratorResult<TChunk>> {
      if (ended) {
        return { done: true, value: undefined };
      }
      started = true;
      try {
        const step = await context.with(spanContext, () => iterator.next());
        if (step.done) {
          end({ code: SpanStatusCode.OK });
          return { done: true, value: undefined };
        }
        return step;
      } catch (err) {
        markFailure(span, err);
        end();
        throw err;
      }
    },
    async return(): Promise<IteratorResult<TChunk>> {
      await close();
      return { done: true, value: undefined };
    },
    async throw(error: Error): Promise<IteratorResult<TChunk>> {
      await close();
      throw error;
    },
    [Symbol.asyncIterator]() {
      return wrapped;
    },
  };

  return setIterable(result, wrapped);
}

/**
 * @description Runs one model request inside a Langfuse generation span, recording the request half before `fn` runs. `fn` records the response half with `observeGeneration`; errors mark the span ERROR.
 * @param request {GenerationRecord} - Provider, model, parameters and input sent.
 * @param fn {(span: Span) => Promise<T>} - Issues the request and returns its result.
 * @returns {Promise<T>} Whatever `fn` resolves to.
 */
export async function withGeneration<T>(
  request: GenerationRecord,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(
    {
      name: generationName(request.operation),
      tracer: tracers.generation,
      kind: SpanKind.CLIENT,
    },
    async (span) => {
      observeGeneration(span, request);
      return fn(span);
    },
  );
}

/** Convenience CLIENT-kind alias matching `withClientSpan`. */
export async function withClientStreamSpan<TResult, TChunk>(
  options: Omit<SpanOptions, "kind">,
  fn: (span: Span) => Promise<TResult>,
  getIterable: (result: TResult) => AsyncIterable<TChunk>,
  setIterable: (
    result: TResult,
    wrapped: AsyncIterableIterator<TChunk>,
  ) => TResult,
): Promise<TResult> {
  return withStreamSpan(
    { ...options, kind: SpanKind.CLIENT },
    fn,
    getIterable,
    setIterable,
  );
}

/**
 * @description Runs `fn` inside a `step` span, for a single model call that belongs to a step outside the shared loop, such as a forced finalization request.
 * @param stepNumber {number} - One-based step number within the turn.
 * @param fn {() => Promise<T>} - The step's work.
 * @returns {Promise<T>} Whatever `fn` resolves to.
 */
export async function withStepSpan<T>(
  stepNumber: number,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(
    { name: stepSpanName(), tracer: tracers.sdk },
    async (span) => {
      observe(span, "span", { metadata: { step_index: stepNumber } });
      return fn();
    },
  );
}

/**
 * @description Groups the observations of each agentic loop step under one `step` span. Call `begin` at the top of a step, run the step's model call and tool dispatch through `run`, and `end` when the loop is over; `begin` closes the previous step.
 */
export class StepSpans {
  private current: Span | undefined;

  /**
   * @description Closes the previous step and opens `step` under the active span.
   * @param stepNumber {number} - One-based step number within the turn.
   * @returns {void} Nothing.
   */
  begin(stepNumber: number): void {
    this.end();
    this.current = tracers.sdk.startSpan(stepSpanName(), {
      kind: SpanKind.INTERNAL,
    });
    observe(this.current, "span", { metadata: { step_index: stepNumber } });
  }

  /**
   * @description Runs `fn` with the open step as the active span, so the observations it creates become the step's children.
   * @param fn {() => T} - Work belonging to the current step.
   * @returns {T} Whatever `fn` returns.
   */
  run<T>(fn: () => T): T {
    const step = this.current;
    return step
      ? context.with(trace.setSpan(context.active(), step), fn)
      : fn();
  }

  /**
   * @description Closes the open step, if any.
   * @returns {void} Nothing.
   */
  end(): void {
    this.current?.end();
    this.current = undefined;
  }
}
