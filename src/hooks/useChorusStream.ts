import React from 'react';
import type { ConnectorName, Message } from '../types';
import { getConnector, type Connector, type ConnectorToolDelta } from '../connectors/connectors';
import { useLatestRef } from './useLatestRef';

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
  onDone?: () => void;
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
    if (hasOwn(delta, 'input')) next.input = mergeToolValue(current.input, delta.input);
    if (hasOwn(delta, 'output')) next.output = mergeToolValue(current.output, delta.output);

    pending.set(delta.id, next);
    return next;
  };
}

function createDelayedChunkEmitter(cb: SendCallbacks, startedAt: number, signal: AbortSignal) {
  const minDelayMs = Math.max(0, cb.minDelayMs ?? 0);
  let hasDeliveredFirstTextChunk = false;
  let released = minDelayMs === 0;
  let cancelled = false;
  let bufferedEvents: DelayedStreamEvent[] = [];
  let releasePromise: Promise<void> | null = null;
  let resolveRelease: (() => void) | null = null;
  let rejectRelease: ((err: Error) => void) | null = null;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let abortListener: ((event: Event) => void) | null = null;

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
    if (cancelled || released) return;
    released = true;
    const events = bufferedEvents;
    bufferedEvents = [];
    settleScheduledRelease();
    for (const event of events) deliverEvent(event);
  };

  const cancel = () => {
    cancelled = true;
    bufferedEvents = [];
    rejectScheduledRelease(createAbortError());
  };

  const scheduleRelease = () => {
    if (released || cancelled) return Promise.resolve();

    const wait = Math.max(0, minDelayMs - (Date.now() - startedAt));
    if (wait <= 0) {
      flushBufferedEvents();
      return Promise.resolve();
    }

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
        releaseTimer = setTimeout(flushBufferedEvents, wait);
      });
    }

    return releasePromise;
  };

  const handleEvent = (event: DelayedStreamEvent) => {
    if (cancelled) return;
    if ((event.type === 'text' || event.type === 'reasoning') && !event.chunk) return;

    if (released || Date.now() - startedAt >= minDelayMs) {
      if (!released) flushBufferedEvents();
      deliverEvent(event);
      return;
    }

    bufferedEvents.push(event);
    void scheduleRelease().catch(() => undefined);
  };

  const flushBeforeDone = async () => {
    if (!released && bufferedEvents.length > 0) await scheduleRelease();
  };

  return {
    handleChunk: (chunk: string) => handleEvent({ type: 'text', chunk }),
    handleReasoning: (chunk: string) => handleEvent({ type: 'reasoning', chunk }),
    handleToolDelta: (toolDelta: ConnectorToolDelta) => handleEvent({ type: 'toolDelta', toolDelta }),
    flushBeforeDone,
    cancel,
  };
}

/**
 * Robust SSE reader:
 * - Parses the stream line-by-line (handles CR, LF, and chunk boundaries)
 * - Collects "data:" lines for an event; dispatches on a blank line
 * - Preserves empty data lines (blank lines inside payloads)
 */
export function readSSEStream(res: Response, onEvent: (payload: string) => unknown): Promise<void> {
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
        if (stopped) {
          try { await reader.cancel(); } catch {}
        }
        resolve();
      } catch (err) {
        try { await reader.cancel(); } catch {}
        reject(err);
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

  const send = React.useCallback(async (text: string, history: Message<TMeta>[], cb: SendCallbacks, externalSignal?: AbortSignal) => {
    if (isSendingRef.current) return;
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

    setSending(true);
    const startedAt = Date.now();
    const delayedChunks = createDelayedChunkEmitter(cb, startedAt, signal);
    const accumulateToolDelta = createToolDeltaAccumulator();

    const finish = async () => {
      await delayedChunks.flushBeforeDone();
      cb.onDone?.();
      isSendingRef.current = false;
      setSending(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    };

    try {
      const res = await transportRef.current(text, history, signal);
      if (!res.ok || !res.body) throw new Error(`Bad response (${res.status}) or missing body`);

      await readSSEStream(res, (payload) => {
        const out = connectorRef.current.extract(payload);
        if (!out) return;

        const chunk = out.text || '';
        if (chunk) delayedChunks.handleChunk(chunk);

        const reasoning = out.reasoning || '';
        if (reasoning) delayedChunks.handleReasoning(reasoning);

        if (out.toolDelta) delayedChunks.handleToolDelta(accumulateToolDelta(out.toolDelta));

        if (out.error) throw new Error(out.error);
        if (out.done) return false;
      });

      await finish();
    } catch (e: unknown) {
      delayedChunks.cancel();
      if (!isAbortError(e)) cb.onError?.(e instanceof Error ? e : new Error(String(e)));
      isSendingRef.current = false;
      setSending(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [transportRef, connectorRef]);

  const abort = React.useCallback(() => { controllerRef.current?.abort(); }, []);
  return { send, abort, sending };
}
