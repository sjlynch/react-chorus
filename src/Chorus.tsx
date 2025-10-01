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
}

export function Chorus({ messages, value, onChange, onSend, placeholder, palette, sending: sendingProp, minAssistantDelayMs = 1000 }: ChorusProps) {
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

  const controllerRef = React.useRef<AbortController | null>(null);
  const hasStartedAssistantRef = React.useRef(false);
  const pendingAssistantIdRef = React.useRef<string | null>(null);

  const startAssistantIfNeeded = (firstChunk: string) => {
    if (!hasStartedAssistantRef.current) {
      const id = 'assistant-' + Date.now();
      pendingAssistantIdRef.current = id;
      hasStartedAssistantRef.current = true;
      updateMsgs(prev => prev.concat({ id, role: 'assistant', text: firstChunk }));
    } else if (pendingAssistantIdRef.current) {
      updateMsgs(prev => prev.map(m => m.id === pendingAssistantIdRef.current ? { ...m, text: m.text + firstChunk } : m));
    }
  };

  const appendAssistant = (chunk: string) => {
    if (!chunk) return;
    if (!hasStartedAssistantRef.current) startAssistantIfNeeded(chunk);
    else if (pendingAssistantIdRef.current) updateMsgs(prev => prev.map(m => m.id === pendingAssistantIdRef.current ? { ...m, text: m.text + chunk } : m));
  };

  const finalizeAssistant = () => {
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    setInternalSending(false);
  };

  const send = async () => {
    if (sending) return;
    const text = draft.trim();
    if (!text) return;

    controllerRef.current?.abort();
    controllerRef.current = new AbortController();

    const userMsg: Message = { id: String(Date.now()), role: 'user', text };
    setDraft('');
    updateMsgs(prev => prev.concat(userMsg));

    if (!onSend) return;

    try {
      setInternalSending(true);
      hasStartedAssistantRef.current = false;
      pendingAssistantIdRef.current = null;

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
    controllerRef.current?.abort();
    finalizeAssistant();
  };

  return (
    <ChorusTheme palette={palette}>
      <div className="chorus">
        <ChatWindow messages={msgs} typing={!!onSend && sending && !hasStartedAssistantRef.current} />
        <ChatInput value={draft} onChange={setDraft} onSend={send} onStop={stop} sending={sending} placeholder={placeholder} />
      </div>
    </ChorusTheme>
  );
}

export default Chorus;
