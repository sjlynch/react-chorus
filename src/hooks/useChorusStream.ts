import React from 'react';
import type { Message } from '../types';

export interface SendCallbacks {
  onStart?: (firstChunk: string) => void;
  onChunk: (chunk: string) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
  minDelayMs?: number;
}

export type Transport = (text: string, history: Message[], signal: AbortSignal) => Promise<Response>;

export function useChorusStream(transport: Transport) {
  const [sending, setSending] = React.useState(false);
  const controllerRef = React.useRef<AbortController | null>(null);

  const send = React.useCallback(async (text: string, history: Message[], cb: SendCallbacks, externalSignal?: AbortSignal) => {
    if (sending) return;

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
      cb.onDone && cb.onDone();
      setSending(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    };

    try {
      const res = await transport(text, history, signal);
      if (!res.ok || !res.body) throw new Error(`Bad response (${res.status}) or missing body`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let started = false;

      const emitPayload = (payload: string) => {
        const sentinel = payload.replace(/\r?\n/g, '');
        if (sentinel === '[DONE]' || sentinel === 'done') return;
        // Deliver the first chunk to onStart OR onChunk (not both) to avoid duplication
        if (!started) {
          started = true;
          if (cb.onStart) cb.onStart(payload);
          else cb.onChunk(payload);
          return;
        }
        cb.onChunk(payload);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const ev of events) {
          const dataLines: string[] = [];
          for (const line of ev.split('\n')) if (line.startsWith('data:')) dataLines.push(line.slice(5));
          if (dataLines.length) emitPayload(dataLines.join('\n'));
        }
      }

      buffer += decoder.decode();
      if (buffer) {
        const maybeLines = buffer.split('\n');
        if (maybeLines.some(l => l.startsWith('data:'))) {
          const dataLines: string[] = [];
          for (const l of maybeLines) if (l.startsWith('data:')) dataLines.push(l.slice(5));
          if (dataLines.length) emitPayload(dataLines.join('\n'));
        } else {
          emitPayload(buffer);
        }
      }

      await finish();
    } catch (e: any) {
      if (e?.name !== 'AbortError') cb.onError && cb.onError(e instanceof Error ? e : new Error(String(e)));
      setSending(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [sending, transport]);

  const abort = React.useCallback(() => { controllerRef.current?.abort(); }, []);
  return { send, abort, sending };
}
