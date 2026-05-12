import React from 'react';
import type { ConnectorName, Message } from '../types';
import { getConnector, type Connector } from '../connectors/connectors';
import { useLatestRef } from './useLatestRef';

export interface SendCallbacks {
  /**
   * Optional notification fired with the first non-empty stream chunk.
   * The same first chunk is also delivered to onChunk.
   */
  onStart?: (firstChunk: string) => void;
  /** Receives every non-empty stream chunk, including the first one. */
  onChunk: (chunk: string) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
  minDelayMs?: number;
}

export type Transport<TMeta = Record<string, unknown>> = (text: string, history: Message<TMeta>[], signal: AbortSignal) => Promise<Response>;

export interface StreamOptions {
  connector?: Connector | ConnectorName;
}

function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
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

    const finish = async () => {
      const wait = Math.max(0, (cb.minDelayMs ?? 0) - (Date.now() - startedAt));
      if (wait) await new Promise(r => setTimeout(r, wait));
      cb.onDone?.();
      isSendingRef.current = false;
      setSending(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    };

    try {
      const res = await transportRef.current(text, history, signal);
      if (!res.ok || !res.body) throw new Error(`Bad response (${res.status}) or missing body`);

      let started = false;
      await readSSEStream(res, (payload) => {
        const out = connectorRef.current.extract(payload);
        if (!out) return;
        if (out.error) throw new Error(out.error);

        const chunk = out.text || '';
        if (chunk) {
          if (!started) {
            started = true;
            if (cb.onStart) cb.onStart(chunk);
            cb.onChunk(chunk);
          } else {
            cb.onChunk(chunk);
          }
        }

        if (out.done) return false;
      });

      await finish();
    } catch (e: unknown) {
      if (!isAbortError(e)) cb.onError?.(e instanceof Error ? e : new Error(String(e)));
      isSendingRef.current = false;
      setSending(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [transportRef, connectorRef]);

  const abort = React.useCallback(() => { controllerRef.current?.abort(); }, []);
  return { send, abort, sending };
}
