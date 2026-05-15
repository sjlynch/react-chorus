import React from 'react';
import type { ConnectorName, Message } from '../types';
import { getConnector, type Connector, type ConnectorToolDelta } from '../connectors/connectors';
import { useLatestRef } from './useLatestRef';
import { isChorusDevMode } from '../utils/devMode';

export interface SendCallbacks {
  /**
   * Optional notification fired when the first non-empty text stream chunk is delivered.
   * The same first text chunk is also delivered to onChunk.
   */
  onStart?: (firstChunk: string) => void;
  /** Receives every non-empty text stream chunk, including the first one. */
  onChunk: (chunk: string) => void;
  /** Receives non-empty reasoning/thinking chunks when the connector exposes them. */
  onReasoning?: (chunk: string) => void;
  /** Receives accumulated tool-call deltas when the connector exposes them. */
  onToolDelta?: (toolDelta: ConnectorToolDelta) => void;
  /**
   * Called after a successful stream completes. If this callback throws, send() rejects
   * with that callback error; onError is not invoked because no stream error occurred.
   */
  onDone?: (response?: Response) => void;
  /**
   * Called for non-abort stream errors. If this callback throws while handling an
   * error, the callback error is warned in development and send() still rejects
   * with the original stream error.
   */
  onError?: (err: Error) => void;
  /** Minimum elapsed time from send() start before delivering the first chunk. */
  minDelayMs?: number;
}

export type Transport<TMeta = Record<string, unknown>> = (text: string, history: Message<TMeta>[], signal: AbortSignal) => Promise<Response>;

export interface StreamOptions {
  connector?: Connector | ConnectorName;
}

function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

function createAbortError() {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

type DelayedStreamEvent =
  | { type: 'text'; chunk: string }
  | { type: 'reasoning'; chunk: string }
  | { type: 'toolDelta'; toolDelta: ConnectorToolDelta };

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function tryParseJSON(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeToolValue(previous: unknown, next: unknown) {
  if (typeof next === 'string') {
    const combined = typeof previous === 'string' ? previous + next : next;
    return tryParseJSON(combined);
  }

  if (isRecord(previous) && isRecord(next)) return { ...previous, ...next };
  return next;
}

function createToolDeltaAccumulator() {
  const pending = new Map<string, ConnectorToolDelta>();

  return (delta: ConnectorToolDelta): ConnectorToolDelta => {
    const current = pending.get(delta.id) ?? { id: delta.id };
    const next: ConnectorToolDelta = { ...current };

    if (delta.name) next.name = delta.name;
    if (delta.provider) next.provider = delta.provider;
    if (delta.providerId) next.providerId = delta.providerId;
    if (delta.generated !== undefined) next.generated = delta.generated;
    if (hasOwn(delta, 'input')) next.input = mergeToolValue(current.input, delta.input);
    if (hasOwn(delta, 'output')) next.output = mergeToolValue(current.output, delta.output);

    pending.set(delta.id, next);
    return next;
  };
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) return error as Error;
  return new Error(String(error));
}

function safeOnObserverError(callbackName: string, error: unknown) {
  if (!isChorusDevMode()) return;
  console.warn(`[Chorus] \`${callbackName}\` callback threw and was ignored so the original stream error could be re-thrown.`, error);
}

const MAX_ERROR_BODY_CHARS = 2048;
const ERROR_BODY_READ_TIMEOUT_MS = 250;

async function readErrorBodySnippet(res: Response, maxChars = MAX_ERROR_BODY_CHARS): Promise<{ text: string; truncated: boolean }> {
  const clone = res.clone();
  if (!clone.body) return { text: '', truncated: false };

  const reader = clone.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let truncated = false;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const readWithTimeout = () => new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      reject(new Error('Timed out reading error response body'));
    }, ERROR_BODY_READ_TIMEOUT_MS);

    reader.read().then(resolve, reject).finally(() => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
    });
  });

  try {
    while (text.length < maxChars) {
      const { value, done } = await readWithTimeout();
      if (done) {
        text += decoder.decode();
        return { text, truncated };
      }

      text += decoder.decode(value, { stream: true });
      if (text.length >= maxChars) {
        truncated = true;
        text = text.slice(0, maxChars);
        break;
      }
    }
  } catch {
    truncated = truncated || timedOut;
  } finally {
    reader.cancel().catch(() => undefined);
    if (timeout !== null) clearTimeout(timeout);
  }

  return { text, truncated };
}

async function createHttpResponseError(res: Response) {
  const statusText = res.statusText ? ` ${res.statusText}` : '';
  const { text, truncated } = await readErrorBodySnippet(res);
  const detail = text.trim();
  const bodyDetail = detail ? `: ${detail}${truncated ? '…' : ''}` : '';
  return new Error(`HTTP ${res.status}${statusText}${bodyDetail}`);
}

function createDelayedChunkEmitter(cb: SendCallbacks, startedAt: number, signal: AbortSignal) {
  const minDelayMs = Math.max(0, cb.minDelayMs ?? 0);
  let hasDeliveredFirstTextChunk = false;
  let released = minDelayMs === 0;
  let cancelled = false;
  let bufferedEvents: DelayedStreamEvent[] = [];
  let releasePromise: Promise<void> | null = null;
  let deliveryPromise: Promise<void> | null = null;
  let callbackError: Error | null = null;
  let rejectCallbackError!: (err: Error) => void;
  let resolveRelease: (() => void) | null = null;
  let rejectRelease: ((err: Error) => void) | null = null;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let abortListener: ((event: Event) => void) | null = null;

  const callbackErrorPromise = new Promise<never>((_, reject) => {
    rejectCallbackError = reject;
  });
  callbackErrorPromise.catch(() => undefined);

  const cleanupScheduledRelease = () => {
    if (releaseTimer !== null) {
      clearTimeout(releaseTimer);
      releaseTimer = null;
    }

    if (abortListener) {
      signal.removeEventListener('abort', abortListener);
      abortListener = null;
    }

    resolveRelease = null;
    rejectRelease = null;
  };

  const settleScheduledRelease = () => {
    const resolve = resolveRelease;
    cleanupScheduledRelease();
    releasePromise = null;
    resolve?.();
  };

  const rejectScheduledRelease = (err: Error) => {
    const reject = rejectRelease;
    cleanupScheduledRelease();
    releasePromise = null;
    reject?.(err);
  };

  const failDelivery = (err: unknown) => {
    const error = toError(err);
    if (!callbackError) {
      callbackError = error;
      cancelled = true;
      bufferedEvents = [];
      rejectScheduledRelease(error);
      rejectCallbackError(error);
    }
    return callbackError;
  };

  const throwIfDeliveryFailed = () => {
    if (callbackError) throw callbackError;
  };

  const throwIfCancelled = () => {
    if (cancelled) throw createAbortError();
  };

  const deliverSafely = (deliver: () => void) => {
    try {
      deliver();
    } catch (err) {
      throw failDelivery(err);
    }
  };

  const deliverEvent = (event: DelayedStreamEvent) => {
    if (cancelled) return;

    if (event.type === 'text') {
      if (!hasDeliveredFirstTextChunk) {
        hasDeliveredFirstTextChunk = true;
        cb.onStart?.(event.chunk);
      }
      cb.onChunk(event.chunk);
      return;
    }

    if (event.type === 'reasoning') {
      cb.onReasoning?.(event.chunk);
      return;
    }

    cb.onToolDelta?.(event.toolDelta);
  };

  const flushBufferedEvents = () => {
    throwIfDeliveryFailed();
    if (cancelled || released) return;
    released = true;
    const events = bufferedEvents;
    bufferedEvents = [];
    for (const event of events) deliverEvent(event);
    settleScheduledRelease();
  };

  const cancel = () => {
    cancelled = true;
    bufferedEvents = [];
    rejectScheduledRelease(createAbortError());
  };

  const scheduleRelease = () => {
    if (released || cancelled) return Promise.resolve();

    const wait = Math.max(0, minDelayMs - (Date.now() - startedAt));
    if (wait <= 0) return Promise.resolve();

    if (signal.aborted) {
      cancel();
      return Promise.reject(createAbortError());
    }

    if (!releasePromise) {
      releasePromise = new Promise<void>((resolve, reject) => {
        resolveRelease = resolve;
        rejectRelease = reject;
        abortListener = () => {
          cancelled = true;
          bufferedEvents = [];
          rejectScheduledRelease(createAbortError());
        };
        signal.addEventListener('abort', abortListener, { once: true });
        releaseTimer = setTimeout(settleScheduledRelease, wait);
      });
    }

    return releasePromise;
  };

  const scheduleBufferedDelivery = () => {
    if (deliveryPromise) return deliveryPromise;

    deliveryPromise = scheduleRelease()
      .then(() => deliverSafely(flushBufferedEvents))
      .catch((err: unknown) => {
        if (!isAbortError(err)) failDelivery(err);
      })
      .finally(() => {
        deliveryPromise = null;
      });

    return deliveryPromise;
  };

  const handleEvent = (event: DelayedStreamEvent) => {
    throwIfDeliveryFailed();
    if (cancelled) return;
    if ((event.type === 'text' || event.type === 'reasoning') && !event.chunk) return;

    if (released || Date.now() - startedAt >= minDelayMs) {
      deliverSafely(() => {
        if (!released) flushBufferedEvents();
        deliverEvent(event);
      });
      return;
    }

    bufferedEvents.push(event);
    void scheduleBufferedDelivery();
  };

  const flushBeforeDone = async () => {
    if (!released && bufferedEvents.length > 0) await scheduleBufferedDelivery();
    else if (deliveryPromise) await deliveryPromise;
    throwIfDeliveryFailed();
    throwIfCancelled();
  };

  return {
    handleChunk: (chunk: string) => handleEvent({ type: 'text', chunk }),
    handleReasoning: (chunk: string) => handleEvent({ type: 'reasoning', chunk }),
    handleToolDelta: (toolDelta: ConnectorToolDelta) => handleEvent({ type: 'toolDelta', toolDelta }),
    flushBeforeDone,
    cancel,
    callbackErrorPromise,
    getCallbackError: () => callbackError,
  };
}

/**
 * Robust SSE reader:
 * - Parses the stream line-by-line (handles CR, LF, and chunk boundaries)
 * - Collects "data:" lines for an event; dispatches on a blank line
 * - Preserves empty data lines (blank lines inside payloads)
 */
export function readSSEStream(res: Response, onEvent: (payload: string) => unknown, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortError());
  if (!res.body) return Promise.resolve();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let currentLine = '';
  let skipNextLF = false;
  let dataLines: string[] = [];
  let stopped = false;

  const flushEvent = () => {
    if (!dataLines.length || stopped) return;
    const payload = dataLines.join('\n');
    dataLines = [];
    if (onEvent(payload) === false) stopped = true;
  };

  const processLine = (line: string) => {
    if (stopped) return;
    if (line === '') { flushEvent(); return; }
    if (line.startsWith('data:')) {
      let v = line.slice(5);
      if (v.startsWith(' ')) v = v.slice(1);
      dataLines.push(v);
    }
  };

  const processText = (text: string) => {
    for (let i = 0; !stopped && i < text.length; i += 1) {
      const ch = text[i];

      if (skipNextLF) {
        skipNextLF = false;
        if (ch === '\n') continue;
      }

      if (ch === '\r') {
        processLine(currentLine);
        currentLine = '';
        skipNextLF = true;
      } else if (ch === '\n') {
        processLine(currentLine);
        currentLine = '';
      } else {
        currentLine += ch;
      }
    }
  };

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    const settleResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const settleReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const cancelReader = async () => {
      try { await reader.cancel(); } catch {}
    };

    function onAbort() {
      stopped = true;
      dataLines = [];
      currentLine = '';
      void cancelReader();
      settleReject(createAbortError());
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    (async () => {
      try {
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          processText(decoder.decode(value, { stream: true }));
        }
        if (!stopped) {
          processText(decoder.decode());
          if (currentLine.length) {
            processLine(currentLine);
            currentLine = '';
          }
          flushEvent();
        }
        if (stopped) await cancelReader();
        settleResolve();
      } catch (err) {
        await cancelReader();
        settleReject(err);
      }
    })();
  });
}

export function useChorusStream<TMeta = Record<string, unknown>>(transport: Transport<TMeta>, opts?: StreamOptions) {
  const connector = getConnector(opts?.connector);
  const transportRef = useLatestRef(transport);
  const connectorRef = useLatestRef(connector);

  const [sending, setSending] = React.useState(false);
  const isSendingRef = React.useRef(false);
  const controllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => {
    controllerRef.current?.abort();
  }, []);

  const send = React.useCallback(async (text: string, history: Message<TMeta>[], cb: SendCallbacks, externalSignal?: AbortSignal) => {
    if (externalSignal?.aborted) return;

    if (isSendingRef.current) {
      if (isChorusDevMode()) {
        console.warn('[Chorus] useChorusStream.send was called while a previous send is still in flight; the new call was ignored. Wait for the previous send to finish (await the promise) or call abort() before re-sending.');
      }
      return;
    }

    isSendingRef.current = true;

    let controller: AbortController | null = null;
    let signal: AbortSignal;

    if (externalSignal) {
      signal = externalSignal;
      controllerRef.current = null;
    } else {
      controller = new AbortController();
      controllerRef.current = controller;
      signal = controller.signal;
    }

    const readerController = new AbortController();
    let forwardAbort: (() => void) | null = null;
    if (signal.aborted) {
      readerController.abort();
    } else {
      forwardAbort = () => readerController.abort();
      signal.addEventListener('abort', forwardAbort, { once: true });
    }

    setSending(true);
    const startedAt = Date.now();
    const delayedChunks = createDelayedChunkEmitter(cb, startedAt, signal);
    const accumulateToolDelta = createToolDeltaAccumulator();
    const activeConnector = connectorRef.current;
    const connectorState = activeConnector.createState?.();
    let errorToThrow: unknown;
    let streamPromise: Promise<void> | null = null;

    try {
      const res = await transportRef.current(text, history, signal);
      if (!res.ok) throw await createHttpResponseError(res);
      if (!res.body) throw new Error(`Response body was missing for HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);

      streamPromise = readSSEStream(res, (payload) => {
        const out = activeConnector.extract(payload, connectorState);
        if (!out) return;

        const chunk = out.text || '';
        if (chunk) delayedChunks.handleChunk(chunk);

        const reasoning = out.reasoning || '';
        if (reasoning) delayedChunks.handleReasoning(reasoning);

        const toolDeltas = out.toolDeltas?.length ? out.toolDeltas : out.toolDelta ? [out.toolDelta] : [];
        for (const toolDelta of toolDeltas) delayedChunks.handleToolDelta(accumulateToolDelta(toolDelta));

        if (out.error) throw new Error(out.error);
        if (out.done) return false;
      }, readerController.signal);
      await Promise.race([streamPromise, delayedChunks.callbackErrorPromise]);
      await streamPromise;

      await delayedChunks.flushBeforeDone();
      try {
        cb.onDone?.(res);
      } catch (callbackError) {
        // Completion observers run after the stream has succeeded. Preserve the
        // historical contract that their failures reject send(), but do not route
        // them through onError because there is no underlying stream error.
        errorToThrow = callbackError;
      }
    } catch (e: unknown) {
      readerController.abort();
      if (streamPromise) await streamPromise.catch(() => undefined);
      const caughtError = delayedChunks.getCallbackError() ?? e;
      delayedChunks.cancel();
      if (!isAbortError(caughtError)) {
        const error = toError(caughtError);
        try {
          cb.onError?.(error);
        } catch (callbackError) {
          safeOnObserverError('onError', callbackError);
        }
        errorToThrow = error;
      }
    } finally {
      if (forwardAbort) signal.removeEventListener('abort', forwardAbort);
      isSendingRef.current = false;
      setSending(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }

    if (errorToThrow !== undefined) throw errorToThrow;
  }, [transportRef, connectorRef]);

  const abort = React.useCallback(() => { controllerRef.current?.abort(); }, []);
  return { send, abort, sending };
}
