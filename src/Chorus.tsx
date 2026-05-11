import React from 'react';
import './Chorus.css';
import { ChatWindow } from './components/ChatWindow';
import { ChatInput } from './components/ChatInput';
import { ChorusTheme } from './components/ChorusTheme';
import type { Palette } from './components/ChorusTheme';
import type { Message } from './types';
import { useChorusStream, type Transport } from './hooks/useChorusStream';
import { createFetchSSETransport } from './streaming/createFetchSSETransport';

export type { Transport };

export interface ChorusProps {
  messages?: Message[];
  value?: Message[];
  onChange?: (messages: Message[]) => void;
  /**
   * Simple path: a URL string (POST'd with `{ prompt, history }`) or a Transport
   * function. Chorus handles all streaming internally — no helpers needed.
   *
   * @example
   * <Chorus transport="/api/chat" />
   */
  transport?: string | Transport;
  /**
   * Advanced path: called on every send. Receives streaming helpers so you
   * can drive the assistant message manually or handle non-SSE responses.
   * Use `transport` instead for the common SSE case.
   */
  onSend?: (
    text: string,
    messages: Message[],
    helpers: {
      appendAssistant: (chunk: string) => void;
      finalizeAssistant: () => void;
      signal: AbortSignal;
    }
  ) => Promise<Message | void> | Message | void;
  placeholder?: string;
  palette?: Palette;
  sending?: boolean;
  minAssistantDelayMs?: number;
  codeBlockTheme?: 'dark' | 'light';
}

export function Chorus({
  messages,
  value,
  onChange,
  transport,
  onSend,
  placeholder,
  palette,
  sending: sendingProp,
  minAssistantDelayMs = 1000,
  codeBlockTheme = 'dark',
}: ChorusProps) {
  const [internalMsgs, setInternalMsgs] = React.useState<Message[]>(() => messages || []);
  const msgs = value !== undefined ? value : internalMsgs;

  const msgsRef = React.useRef<Message[]>(msgs);
  React.useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  const updateMsgs = (updater: (prev: Message[]) => Message[]) => {
    const next = updater(msgsRef.current);
    msgsRef.current = next;
    if (value !== undefined) { onChange && onChange(next); } else { setInternalMsgs(next); }
  };

  const [draft, setDraft] = React.useState('');
  const [internalSending, setInternalSending] = React.useState(false);

  // Only used by the onSend (advanced) path
  const controllerRef = React.useRef<AbortController | null>(null);

  const hasStartedAssistantRef = React.useRef(false);
  const pendingAssistantIdRef = React.useRef<string | null>(null);

  // Frame-batched queue to avoid any chance of interleaving/races dropping tokens
  const chunkQueueRef = React.useRef<string[]>([]);
  const rafIdRef = React.useRef<number | null>(null);

  const flushQueue = () => {
    if (!pendingAssistantIdRef.current) return;
    const q = chunkQueueRef.current;
    if (q.length === 0) return;
    const add = q.join('');
    q.length = 0;
    updateMsgs(prev => prev.map(m => m.id === pendingAssistantIdRef.current ? { ...m, text: m.text + add } : m));
  };

  const scheduleFlush = () => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = typeof window !== 'undefined' ? window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      flushQueue();
    }) : null;
  };

  const startAssistant = (firstChunk: string) => {
    const id = 'assistant-' + Date.now();
    pendingAssistantIdRef.current = id;
    hasStartedAssistantRef.current = true;
    chunkQueueRef.current.length = 0;
    updateMsgs(prev => prev.concat({ id, role: 'assistant', text: firstChunk }));
  };

  const appendAssistant = (chunk: string) => {
    if (!chunk) return;
    if (!hasStartedAssistantRef.current) startAssistant(chunk);
    else {
      chunkQueueRef.current.push(chunk);
      scheduleFlush();
    }
  };

  const finalizeAssistant = () => {
    flushQueue();
    if (rafIdRef.current != null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    setInternalSending(false);
  };

  // --- Transport (simple) path ---
  // Always call the hook (Rules of Hooks); a dummy transport is used when `transport` prop is absent.
  const resolvedTransport = React.useMemo((): Transport => {
    if (typeof transport === 'string') return createFetchSSETransport(transport);
    if (typeof transport === 'function') return transport;
    return () => Promise.resolve(new Response(null, { status: 200 }));
  }, [transport]);

  const { send: doStream, abort: streamAbort, sending: streamSending } = useChorusStream(resolvedTransport);

  const sending = sendingProp ?? (transport ? streamSending : internalSending);

  const resetStreamState = () => {
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    chunkQueueRef.current.length = 0;
  };

  const send = async () => {
    if (sending) return;
    const text = draft.trim();
    if (!text) return;

    const userMsg: Message = { id: String(Date.now()), role: 'user', text };
    setDraft('');
    updateMsgs(prev => prev.concat(userMsg));

    // Simple transport path: Chorus drives streaming internally
    if (transport) {
      resetStreamState();
      doStream(text, msgsRef.current, {
        onChunk: appendAssistant,
        onDone: finalizeAssistant,
        onError: resetStreamState,
        minDelayMs: minAssistantDelayMs,
      });
      return;
    }

    // Advanced onSend path
    if (!onSend) return;

    controllerRef.current?.abort();
    controllerRef.current = new AbortController();

    try {
      setInternalSending(true);
      resetStreamState();

      const start = Date.now();
      const res = await onSend(text, msgsRef.current, { appendAssistant, finalizeAssistant, signal: controllerRef.current.signal });

      if (res && typeof res === 'object' && !hasStartedAssistantRef.current) {
        const elapsed = Date.now() - start;
        const wait = Math.max(0, minAssistantDelayMs - elapsed);
        if (wait) await new Promise(r => setTimeout(r, wait));
        updateMsgs(prev => prev.concat({ id: (res as any).id || String(Date.now() + 1), role: 'assistant', text: (res as any).text }));
      }
    } catch {}
    finally {
      if (!hasStartedAssistantRef.current) setInternalSending(false);
    }
  };

  const stop = () => {
    if (!sending) return;
    if (transport) {
      streamAbort();
      finalizeAssistant();
    } else {
      controllerRef.current?.abort();
      finalizeAssistant();
    }
  };

  return (
    <ChorusTheme palette={palette}>
      <div className="chorus">
        <ChatWindow messages={msgs} typing={!!(transport || onSend) && sending && !hasStartedAssistantRef.current} codeTheme={codeBlockTheme} />
        <ChatInput value={draft} onChange={setDraft} onSend={send} onStop={stop} sending={sending} placeholder={placeholder} />
      </div>
    </ChorusTheme>
  );
}

export default Chorus;
