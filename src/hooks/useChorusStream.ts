import React from 'react';
import type { ConnectorName, Message } from '../types';
import { getConnector, type Connector } from '../connectors/connectors';
import { useLatestRef } from './useLatestRef';

export interface SendCallbacks {
  /**
   * Optional notification fired when the first non-empty stream chunk is delivered.
   * The same first chunk is also delivered to onChunk.
   */
  onStart?: (firstChunk: string) => void;
  /** Receives every non-empty stream chunk, including the first one. */
  onChunk: (chunk: string) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
  /** Minimum elapsed time from send() start before delivering the first chunk. */
  minDelayMs?: number;
}

export type Transport = (text: string, history: Message[], signal: AbortSignal) => Promise<Response>;

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

function createDelayedChunkEmitter(cb: SendCallbacks, startedAt: number, signal: AbortSignal) {
  const minDelayMs = Math.max(0, cb.minDelayMs ?? 0);
  let hasDeliveredFirstChunk = false;
  let released = minDelayMs === 0;
  let cancelled = false;
  let bufferedChunks: string[] = [];
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

  const deliverChunk = (chunk: string) => {
    if (cancelled) return;
    if (!hasDeliveredFirstChunk) {
      hasDeliveredFirstChunk = true;
      cb.onStart?.(chunk);
    }
    cb.onChunk(chunk);
  };

  const flushBufferedChunks = () => {
    if (cancelled || released) return;
    released = true;
    const chunks = bufferedChunks;
    bufferedChunks = [];
    settleScheduledRelease();
    for (const chunk of chunks) deliverChunk(chunk);
  };

  const cancel = () => {
    cancelled = true;
    bufferedChunks = [];
    rejectScheduledRelease(createAbortError());
  };

  const scheduleRelease = () => {
    if (released || cancelled) return Promise.resolve();

    const wait = Math.max(0, minDelayMs - (Date.now() - startedAt));
    if (wait <= 0) {
      flushBufferedChunks();
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
          bufferedChunks = [];
          rejectScheduledRelease(createAbortError());
        };
        signal.addEventListener('abort', abortListener, { once: true });
        releaseTimer = setTimeout(flushBufferedChunks, wait);
      });
    }

    return releasePromise;
  };

  const handleChunk = (chunk: string) => {
    if (!chunk || cancelled) return;

    if (released || Date.now() - startedAt >= minDelayMs) {
      if (!released) flushBufferedChunks();
      deliverChunk(chunk);
      return;
    }

    bufferedChunks.push(chunk);
    void scheduleRelease().catch(() => undefined);
  };

  const flushBeforeDone = async () => {
    if (!released && bufferedChunks.length > 0) await scheduleRelease();
  };

  return { handleChunk, flushBeforeDone, cancel };
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

  let buf = '';
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
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line === '') { flushEvent(); return; }
    if (line.startsWith('data:')) {
      let v = line.slice(5);
      if (v.startsWith(' ')) v = v.slice(1);
      dataLines.push(v);
    }
  };

  return new Promise<void>((resolve, reject) => {
    (async () => {
      try {
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          let idx: number;
          while (!stopped && (idx = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            processLine(line);
          }
        }
        if (!stopped) {
          buf += decoder.decode();
          if (buf.length) processLine(buf);
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

export function useChorusStream(transport: Transport, opts?: StreamOptions) {
  const connector = getConnector(opts?.connector);
  const transportRef = useLatestRef(transport);
  const connectorRef = useLatestRef(connector);

  const [sending, setSending] = React.useState(false);
  const isSendingRef = React.useRef(false);
  const controllerRef = React.useRef<AbortController | null>(null);

  const send = React.useCallback(async (text: string, history: Message[], cb: SendCallbacks, externalSignal?: AbortSignal) => {
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
        if (out.error) throw new Error(out.error);

        const chunk = out.text || '';
        if (chunk) delayedChunks.handleChunk(chunk);

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
