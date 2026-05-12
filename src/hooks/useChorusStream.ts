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

export type Transport = (text: string, history: Message[], signal: AbortSignal) => Promise<Response>;

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
export function readSSEStream(res: Response, onEvent: (payload: string) => void): Promise<void> {
  if (!res.body) return Promise.resolve();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buf = '';
  let dataLines: string[] = [];

  const flushEvent = () => {
    if (!dataLines.length) return;
    onEvent(dataLines.join('\n'));
    dataLines = [];
  };

  const processLine = (line: string) => {
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
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            processLine(line);
          }
        }
        buf += decoder.decode();
        if (buf.length) processLine(buf);
        flushEvent();
        resolve();
      } catch (err) {
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
        if (out.done) return; // ignore sentinel; finalize on stream end

        const chunk = out.text || '';
        if (!chunk) return;

        if (!started) {
          started = true;
          if (cb.onStart) cb.onStart(chunk);
          cb.onChunk(chunk);
          return;
        }
        cb.onChunk(chunk);
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
