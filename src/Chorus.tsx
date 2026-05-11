import React from 'react';
import './Chorus.css';
import { ChatWindow } from './components/ChatWindow';
import { ChatInput } from './components/ChatInput';
import { ChorusTheme } from './components/ChorusTheme';
import type { Palette } from './components/ChorusTheme';
import type { Message, Attachment, StorageAdapter } from './types';
import { useChorusStream, type Transport } from './hooks/useChorusStream';
import { createFetchSSETransport } from './streaming/createFetchSSETransport';
import { useChorusPersistence } from './hooks/useChorusPersistence';
import type { Connector } from './connectors/connectors';

export type { Transport };
export type { Connector };

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
   * SSE connector to use when parsing the stream. Defaults to `'auto'` which
   * detects OpenAI and Anthropic formats automatically. Pass `'anthropic'` when
   * pointing `transport` at an Anthropic backend to skip auto-detection and
   * parse `event: content_block_delta` events correctly.
   *
   * @example
   * <Chorus transport="/api/chat" connector="anthropic" />
   */
  connector?: Connector | 'auto' | 'openai' | 'anthropic';
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
  accept?: string;
  /** When set, automatically saves and restores messages using the given key. Defaults to localStorage; pass persistenceStorage to swap the backend. */
  persistenceKey?: string;
  /** Custom storage adapter for persistenceKey. Must implement { getItem, setItem }. Sync (localStorage/sessionStorage) and async (IndexedDB, etc.) adapters are both supported. */
  persistenceStorage?: StorageAdapter;
  /** Strip all default styles and inline style injection — same effect as using react-chorus/headless */
  headless?: boolean;
  renderMessage?: (message: Message) => React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Chorus({
  messages,
  value,
  onChange,
  transport,
  connector,
  onSend,
  placeholder,
  palette,
  sending: sendingProp,
  minAssistantDelayMs = 1000,
  codeBlockTheme = 'dark',
  accept,
  persistenceKey,
  persistenceStorage,
  headless = false,
  renderMessage,
  className,
  style,
}: ChorusProps) {
  // Always called (rules of hooks) — no-op when persistenceKey is absent
  const persisted = useChorusPersistence(persistenceKey ?? '', { storage: persistenceStorage });



  const [internalMsgs, setInternalMsgs] = React.useState<Message[]>(() => messages || []);
  const msgs = value !== undefined ? value : persistenceKey ? persisted.value : internalMsgs;

  const msgsRef = React.useRef<Message[]>(msgs);
  React.useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  const updateMsgs = (updater: (prev: Message[]) => Message[]) => {
    const next = updater(msgsRef.current);
    msgsRef.current = next;
    if (value !== undefined) { onChange?.(next); }
    else if (persistenceKey) { persisted.onChange(next); }
    else { setInternalMsgs(next); }
  };

  const [draft, setDraft] = React.useState('');
  const [internalSending, setInternalSending] = React.useState(false);

  const [streamError, setStreamError] = React.useState<string | null>(null);
  const lastUserTextRef = React.useRef<string>('');


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

  const { send: doStream, abort: streamAbort, sending: streamSending } = useChorusStream(resolvedTransport, { connector });

  const sending = sendingProp ?? (transport ? streamSending : internalSending);

  const resetStreamState = () => {
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    chunkQueueRef.current.length = 0;
  };

  const triggerAssistant = async (text: string) => {
    if (transport) {
      resetStreamState();
      doStream(text, msgsRef.current, {
        onChunk: appendAssistant,
        onDone: finalizeAssistant,
        onError: (err) => { resetStreamState(); setStreamError(err.message || 'Something went wrong. Please try again.'); },
        minDelayMs: minAssistantDelayMs,
      });
      return;
    }
    if (!onSend) return;
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();
    try {
      setInternalSending(true);
      setStreamError(null);
      resetStreamState();

      const start = Date.now();
      const res = await onSend(text, msgsRef.current, { appendAssistant, finalizeAssistant, signal: controllerRef.current.signal });
      if (res && typeof res === 'object' && !hasStartedAssistantRef.current) {
        const elapsed = Date.now() - start;
        const wait = Math.max(0, minAssistantDelayMs - elapsed);
        if (wait) await new Promise(r => setTimeout(r, wait));
        updateMsgs(prev => prev.concat({ id: (res as any).id || String(Date.now() + 1), role: 'assistant', text: (res as any).text }));
      }
    } catch (e: any) {
      const partialId = pendingAssistantIdRef.current;
      if (partialId) updateMsgs(prev => prev.filter(m => m.id !== partialId));
      hasStartedAssistantRef.current = false;
      pendingAssistantIdRef.current = null;
      if (e?.name !== 'AbortError') setStreamError('Something went wrong. Please try again.');
    } finally {
      if (!hasStartedAssistantRef.current) setInternalSending(false);
    }
  };

  const send = async (attachments: Attachment[] = []) => {
    if (sending) return;
    const text = draft.trim();
    if (!text && !attachments.length) return;

    setDraft('');
    lastUserTextRef.current = text;
    updateMsgs(prev => prev.concat({ id: String(Date.now()), role: 'user', text, attachments: attachments.length > 0 ? attachments : undefined }));

    await triggerAssistant(text);
  };

  const retry = async () => {
    const text = lastUserTextRef.current;
    if (!text || sending) return;
    await triggerAssistant(text);
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

  const handleEdit = async (id: string, newText: string) => {
    if (sending) return;
    const current = msgsRef.current;
    const idx = current.findIndex(m => m.id === id);
    if (idx === -1) return;
    const edited: Message = { ...current[idx], text: newText };
    updateMsgs(prev => [...prev.slice(0, idx), edited]);
    await triggerAssistant(newText);
  };

  const handleRegenerate = async (id: string) => {
    if (sending) return;
    const current = msgsRef.current;
    const idx = current.findIndex(m => m.id === id);
    if (idx === -1) return;
    let userIdx = idx - 1;
    while (userIdx >= 0 && current[userIdx].role !== 'user') userIdx--;
    if (userIdx < 0) return;
    const userMsg = current[userIdx];
    updateMsgs(prev => prev.slice(0, userIdx + 1));
    await triggerAssistant(userMsg.text);
  };

  const handleDelete = (id: string) => {
    updateMsgs(prev => prev.filter(m => m.id !== id));
  };

  return (
    <ChorusTheme palette={palette}>
      <div className={["chorus", className].filter(Boolean).join(" ")} style={style}>
        <ChatWindow
          messages={msgs}
          typing={!!(transport || onSend) && sending && !hasStartedAssistantRef.current}
          codeTheme={codeBlockTheme}
          headless={headless}
          renderMessage={renderMessage}
          onEdit={(transport || onSend) ? handleEdit : undefined}
          onRegenerate={(transport || onSend) ? handleRegenerate : undefined}
          onDelete={handleDelete}
          error={streamError}
          onRetry={retry}
        />
        <ChatInput value={draft} onChange={setDraft} onSend={send} onStop={stop} sending={sending} placeholder={placeholder} accept={accept} />
      </div>
    </ChorusTheme>
  );
}

export default Chorus;
