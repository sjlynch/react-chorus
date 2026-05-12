import React from 'react';
import './Chorus.css';
import { ChatWindow } from './components/ChatWindow';
import { ChatInput } from './components/ChatInput';
import { styleVarsFromPalette, type Palette } from './components/ChorusTheme';
import type { Attachment, ConnectorName, Message, Role, StorageAdapter } from './types';
import { useChorusStream, type Transport } from './hooks/useChorusStream';
import { createFetchSSETransport } from './streaming/createFetchSSETransport';
import { useChorusPersistence } from './hooks/useChorusPersistence';
import { useChorusMessages } from './hooks/useChorusMessages';
import { useRAFQueue } from './hooks/useRAFQueue';
import type { Connector } from './connectors/connectors';

export type { Transport };
export type { Connector };

interface ChorusSendHelpers {
  appendAssistant: (chunk: string) => void;
  finalizeAssistant: () => void;
  signal: AbortSignal;
}

const DEFAULT_MIN_ASSISTANT_DELAY_MS = 300;

export interface ChorusProps {
  messages?: Message[];
  /** Initial messages for uncontrolled mode. Useful for welcome messages. */
  initialMessages?: Message[];
  value?: Message[];
  onChange?: (messages: Message[]) => void;
  /** Simple path: URL or Transport function. */
  transport?: string | Transport;
  /** Hidden system prompt prepended to transport request history. */
  systemPrompt?: string;
  connector?: Connector | ConnectorName;
  onSend?: (text: string, messages: Message[], helpers: ChorusSendHelpers) => Promise<Message | void> | Message | void;
  placeholder?: string;
  palette?: Palette;
  sending?: boolean;
  minAssistantDelayMs?: number;
  errorMessage?: string;
  onError?: (error: Error) => void;
  onChunk?: (chunk: string, messageId: string) => void;
  codeBlockTheme?: 'dark' | 'light';
  accept?: string;
  persistenceKey?: string;
  persistenceStorage?: StorageAdapter;
  headless?: boolean;
  renderMessage?: (message: Message) => React.ReactNode;
  hiddenRoles?: Role[];
  className?: string;
  style?: React.CSSProperties;
}

export function Chorus({
  messages,
  initialMessages,
  value,
  onChange,
  transport,
  systemPrompt,
  connector,
  onSend,
  placeholder,
  palette,
  sending: sendingProp,
  minAssistantDelayMs = DEFAULT_MIN_ASSISTANT_DELAY_MS,
  errorMessage,
  onError,
  onChunk,
  codeBlockTheme = 'dark',
  accept,
  persistenceKey,
  persistenceStorage,
  headless = false,
  renderMessage,
  hiddenRoles,
  className,
  style,
}: ChorusProps) {
  const persisted = useChorusPersistence(persistenceKey ?? '', { storage: persistenceStorage });
  const { msgs, updateMsgs, onChunkRef } = useChorusMessages({
    value,
    messages,
    initialMessages,
    onChange,
    persistenceKey,
    persistedMessages: persisted.value,
    onPersistedChange: persisted.onChange,
    onChunk,
  });

  const [draft, setDraft] = React.useState('');
  const [internalSending, setInternalSending] = React.useState(false);
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const fallbackErrorMessage = errorMessage ?? 'Something went wrong. Please try again.';
  const lastUserTextRef = React.useRef<string>('');
  const controllerRef = React.useRef<AbortController | null>(null);
  const hasStartedAssistantRef = React.useRef(false);
  const pendingAssistantIdRef = React.useRef<string | null>(null);

  const { enqueue: enqueueChunk, cancelPending } = useRAFQueue((add) => {
    const id = pendingAssistantIdRef.current;
    if (!id) return;
    updateMsgs(prev => prev.map(m => m.id === id ? { ...m, text: m.text + add } : m));
  });

  const startAssistant = (firstChunk: string) => {
    const id = 'assistant-' + Date.now();
    pendingAssistantIdRef.current = id;
    hasStartedAssistantRef.current = true;
    cancelPending(false);
    updateMsgs(prev => prev.concat({ id, role: 'assistant', text: firstChunk }));
    onChunkRef.current?.(firstChunk, id);
  };

  const appendAssistant = (chunk: string) => {
    if (!chunk) return;
    if (!hasStartedAssistantRef.current) startAssistant(chunk);
    else {
      enqueueChunk(chunk);
      const id = pendingAssistantIdRef.current;
      if (id) onChunkRef.current?.(chunk, id);
    }
  };

  const finalizeAssistant = () => {
    cancelPending(true);
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    setInternalSending(false);
  };

  const resolvedTransport = React.useMemo((): Transport => {
    if (typeof transport === 'string') return createFetchSSETransport(transport);
    if (typeof transport === 'function') return transport;
    return () => Promise.resolve(new Response(null, { status: 200 }));
  }, [transport]);

  const { send: doStream, abort: streamAbort, sending: streamSending } = useChorusStream(resolvedTransport, { connector });
  const sending = sendingProp ?? (transport ? streamSending : internalSending);
  const paletteVars = React.useMemo(() => styleVarsFromPalette(palette), [palette]);

  const resetStreamState = () => {
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    cancelPending(false);
  };

  const historyForTransport = (history: Message[]) => (
    systemPrompt ? [{ id: 'chorus-system-prompt', role: 'system' as const, text: systemPrompt }, ...history] : history
  );

  const triggerAssistant = async (text: string, history: Message[] = msgs) => {
    if (transport) {
      if (process.env.NODE_ENV !== 'production' && onSend) {
        console.warn('[Chorus] Both `transport` and `onSend` props were provided. `transport` takes precedence and `onSend` will be ignored. Remove one of the two props to silence this warning.');
      }
      resetStreamState();
      setStreamError(null);
      doStream(text, historyForTransport(history), {
        onChunk: appendAssistant,
        onDone: finalizeAssistant,
        onError: (err) => { resetStreamState(); onError?.(err); setStreamError(fallbackErrorMessage); },
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
      const res = await onSend(text, history, { appendAssistant, finalizeAssistant, signal: controllerRef.current.signal });
      if (res && typeof res === 'object' && !hasStartedAssistantRef.current) {
        const wait = Math.max(0, minAssistantDelayMs - (Date.now() - start));
        if (wait) await new Promise(r => setTimeout(r, wait));
        updateMsgs(prev => prev.concat({ id: (res as Message).id || String(Date.now() + 1), role: 'assistant', text: (res as Message).text }));
      }
    } catch (e: any) {
      const partialId = pendingAssistantIdRef.current;
      if (partialId) updateMsgs(prev => prev.filter(m => m.id !== partialId));
      hasStartedAssistantRef.current = false;
      pendingAssistantIdRef.current = null;
      if (e?.name !== 'AbortError') {
        const error = e instanceof Error ? e : new Error(String(e));
        onError?.(error);
        setStreamError(fallbackErrorMessage);
      }
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
    const next = updateMsgs(prev => prev.concat({ id: String(Date.now()), role: 'user', text, attachments: attachments.length > 0 ? attachments : undefined }));
    await triggerAssistant(text, next);
  };

  const retry = async () => {
    const text = lastUserTextRef.current;
    if (!text || sending) return;
    await triggerAssistant(text);
  };

  const stop = () => {
    if (!sending) return;
    if (transport) streamAbort();
    else controllerRef.current?.abort();
    finalizeAssistant();
  };

  const handleEdit = async (id: string, newText: string) => {
    if (sending) return;
    const idx = msgs.findIndex(m => m.id === id);
    if (idx === -1) return;
    const edited: Message = { ...msgs[idx], text: newText };
    const next = updateMsgs(prev => [...prev.slice(0, idx), edited]);
    await triggerAssistant(newText, next);
  };

  const handleRegenerate = async (id: string) => {
    if (sending) return;
    const idx = msgs.findIndex(m => m.id === id);
    if (idx === -1) return;
    let userIdx = idx - 1;
    while (userIdx >= 0 && msgs[userIdx].role !== 'user') userIdx--;
    if (userIdx < 0) return;
    const userMsg = msgs[userIdx];
    const next = updateMsgs(prev => prev.slice(0, userIdx + 1));
    await triggerAssistant(userMsg.text, next);
  };

  const handleDelete = (id: string) => updateMsgs(prev => prev.filter(m => m.id !== id));

  return (
    <div className={["chorus", className].filter(Boolean).join(" ")} style={{ ...paletteVars, ...style }}>
      <ChatWindow messages={msgs} typing={!!(transport || onSend) && sending && !hasStartedAssistantRef.current} codeTheme={codeBlockTheme} headless={headless} renderMessage={renderMessage} hiddenRoles={hiddenRoles} onEdit={(transport || onSend) ? handleEdit : undefined} onRegenerate={(transport || onSend) ? handleRegenerate : undefined} onDelete={handleDelete} error={streamError} onRetry={retry} />
      <ChatInput value={draft} onChange={setDraft} onSend={send} onStop={stop} sending={sending} placeholder={placeholder} accept={accept} />
    </div>
  );
}

export default Chorus;
