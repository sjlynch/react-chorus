import React from 'react';
import './Chorus.css';
import { ChatWindow } from './components/ChatWindow';
import { ChatInput } from './components/ChatInput';
import { ChorusTheme } from './components/ChorusTheme';
import type { Palette } from './components/ChorusTheme';
import type { Message } from './types';

export interface ChorusProps {
  messages?: Message[];
  value?: Message[];
  onChange?: (messages: Message[]) => void;
  onSend?: (text: string, messages: Message[], helpers: { appendAssistant: (chunk: string) => void; finalizeAssistant: () => void; signal: AbortSignal }) => Promise<Message | void> | Message | void;
  placeholder?: string;
  palette?: Palette;
  sending?: boolean;
  minAssistantDelayMs?: number;
  codeBlockTheme?: 'dark' | 'light';
}

export function Chorus({ messages, value, onChange, onSend, placeholder, palette, sending: sendingProp, minAssistantDelayMs = 1000, codeBlockTheme = 'dark' }: ChorusProps) {
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
  const sending = sendingProp ?? internalSending;

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

  const runSend = async (text: string) => {
    if (!onSend) return;

    controllerRef.current?.abort();
    controllerRef.current = new AbortController();

    try {
      setInternalSending(true);
      setStreamError(null);
      hasStartedAssistantRef.current = false;
      pendingAssistantIdRef.current = null;
      chunkQueueRef.current.length = 0;

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

  const send = async () => {
    if (sending) return;
    const text = draft.trim();
    if (!text) return;

    setDraft('');
    lastUserTextRef.current = text;
    updateMsgs(prev => prev.concat({ id: String(Date.now()), role: 'user', text }));

    await runSend(text);
  };

  const retry = async () => {
    const text = lastUserTextRef.current;
    if (!text || sending) return;
    await runSend(text);
  };

  const stop = () => {
    if (!sending) return;
    controllerRef.current?.abort();
    finalizeAssistant();
  };

  return (
    <ChorusTheme palette={palette}>
      <div className="chorus">
        <ChatWindow messages={msgs} typing={!!onSend && sending && !hasStartedAssistantRef.current} codeTheme={codeBlockTheme} error={streamError} onRetry={retry} />
        <ChatInput value={draft} onChange={setDraft} onSend={send} onStop={stop} sending={sending} placeholder={placeholder} />
      </div>
    </ChorusTheme>
  );
}

export default Chorus;
