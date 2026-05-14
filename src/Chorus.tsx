import React from 'react';
import './Chorus.css';
import { ChatWindow, type MessageMarkdownProps, type RenderErrorContext, type RenderMessageContext } from './components/ChatWindow';
import { ChatInput } from './components/ChatInput';
import { styleVarsFromPalette, type Palette } from './components/ChorusTheme';
import type { Attachment, AttachmentError, ConnectorName, Message, Role, StorageAdapter, UploadAttachment } from './types';
import { useChorusStream, type Transport } from './hooks/useChorusStream';
import { createFetchSSETransport } from './streaming/createFetchSSETransport';
import { useChorusPersistence } from './hooks/useChorusPersistence';
import { useChorusMessages } from './hooks/useChorusMessages';
import { useRAFQueue } from './hooks/useRAFQueue';
import type { Connector } from './connectors/connectors';
import type { MarkdownSanitizer } from './components/Markdown';
import { isChorusDevMode } from './utils/devMode';

export type { Transport };
export type { Connector };

export interface ChorusSendHelpers {
  appendAssistant: (chunk: string) => void;
  finalizeAssistant: () => void;
  signal: AbortSignal;
}

export type ChorusOnSend<TMeta = Record<string, unknown>> = (
  text: string,
  messages: Message<TMeta>[],
  helpers: ChorusSendHelpers,
) => Promise<Message<TMeta> | void> | Message<TMeta> | void;

const DEFAULT_MIN_ASSISTANT_DELAY_MS = 300;
const DEFAULT_PERSISTENCE_WRITE_DEBOUNCE_MS = 80;
let fallbackMessageIdCounter = 0;

function createMessageId() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);

  fallbackMessageIdCounter += 1;
  return `chorus-${Date.now()}-${fallbackMessageIdCounter}`;
}

function dropTrailingAssistant<TMeta>(history: Message<TMeta>[]) {
  const last = history[history.length - 1];
  return last?.role === 'assistant' ? history.slice(0, -1) : history;
}

function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

interface SubmittedUserTurn<TMeta = Record<string, unknown>> {
  text: string;
  history: Message<TMeta>[];
}

function cloneMessageForRetry<TMeta>(message: Message<TMeta>): Message<TMeta> {
  return {
    ...message,
    attachments: message.attachments?.map(attachment => ({ ...attachment })),
  };
}

function cloneHistoryForRetry<TMeta>(history: Message<TMeta>[]): Message<TMeta>[] {
  return history.map(message => cloneMessageForRetry(message));
}

function findLastUserMessage<TMeta>(history: Message<TMeta>[]) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === 'user') return history[i];
  }
  return null;
}

export interface ChorusProps<TMeta = Record<string, unknown>> {
  accept?: string;
  className?: string;
  /** Accessible/button label for the built-in clear action. */
  clearLabel?: string;
  codeBlockTheme?: 'dark' | 'light';
  connector?: Connector | ConnectorName;
  emptyState?: React.ReactNode;
  errorMessage?: string;
  headless?: boolean;
  hiddenRoles?: Role[];
  /** Initial messages for uncontrolled mode. Useful for welcome messages. */
  initialMessages?: Message<TMeta>[];
  /** Props forwarded to the built-in Markdown renderer for message text. */
  markdownProps?: MessageMarkdownProps;
  /** Convenience alias for markdownProps.sanitizer. Takes precedence when both are provided. */
  markdownSanitizer?: MarkdownSanitizer;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
  /** Render only the latest N visible messages. Typing and error rows still render outside this message window. */
  maxRenderedMessages?: number;
  messages?: Message<TMeta>[];
  minAssistantDelayMs?: number;
  onAttachmentError?: (error: AttachmentError) => void;
  onChange?: (messages: Message<TMeta>[]) => void;
  onChunk?: (chunk: string, messageId: string) => void;
  /** Called after the clear/reset action chooses the next message list. */
  onClear?: (messages: Message<TMeta>[]) => void;
  onError?: (error: Error) => void;
  /** Called when Chorus cannot write the transcript to persistenceStorage. */
  onPersistenceError?: (error: Error) => void;
  onSend?: ChorusOnSend<TMeta>;
  palette?: Palette;
  persistenceKey?: string;
  persistenceStorage?: StorageAdapter;
  placeholder?: string;
  renderError?: (context: RenderErrorContext) => React.ReactNode;
  renderMessage?: (message: Message<TMeta>, context: RenderMessageContext<TMeta>) => React.ReactNode;
  /** When clearing, restore initialMessages/messages instead of clearing to []. Defaults to false. */
  resetToInitialMessages?: boolean;
  sending?: boolean;
  /** Show a built-in button that clears/resets the conversation. */
  showClearButton?: boolean;
  showJumpToBottomButton?: boolean;
  style?: React.CSSProperties;
  suggestedPrompts?: string[];
  /** Hidden system prompt prepended to transport request history. */
  systemPrompt?: string;
  /** Simple path: URL or Transport function. */
  transport?: string | Transport<TMeta>;
  uploadAttachment?: UploadAttachment;
  value?: Message<TMeta>[];
}

export function Chorus<TMeta = Record<string, unknown>>({
  accept,
  className,
  clearLabel = 'Clear conversation',
  codeBlockTheme = 'dark',
  connector,
  emptyState,
  errorMessage,
  headless = false,
  hiddenRoles,
  initialMessages,
  markdownProps,
  markdownSanitizer,
  maxAttachmentBytes,
  maxAttachments,
  maxRenderedMessages,
  messages,
  minAssistantDelayMs = DEFAULT_MIN_ASSISTANT_DELAY_MS,
  onAttachmentError,
  onChange,
  onChunk,
  onClear,
  onError,
  onPersistenceError,
  onSend,
  palette,
  persistenceKey,
  persistenceStorage,
  placeholder,
  renderError,
  renderMessage,
  resetToInitialMessages = false,
  sending: sendingProp,
  showClearButton = false,
  showJumpToBottomButton = !headless,
  style,
  suggestedPrompts,
  systemPrompt,
  transport,
  uploadAttachment,
  value,
}: ChorusProps<TMeta>) {
  const persisted = useChorusPersistence<TMeta>(persistenceKey ?? '', {
    storage: persistenceStorage,
    writeDebounceMs: DEFAULT_PERSISTENCE_WRITE_DEBOUNCE_MS,
    onError: onPersistenceError,
  });
  const { msgs, updateMsgs, onChunkRef, seedMessages } = useChorusMessages<TMeta>({
    value,
    messages,
    initialMessages,
    onChange,
    persistenceKey,
    persistedMessages: persisted.value,
    persistenceLoaded: persisted.loaded,
    hasPersistedValue: persisted.hasStoredValue,
    canPersist: persisted.canPersist,
    onPersistedChange: persisted.onChange,
    onChunk,
  });

  React.useEffect(() => {
    if (!isChorusDevMode()) return;

    if (messages !== undefined && onChange) {
      console.warn('[Chorus] `messages` is initial-only and does not make <Chorus> controlled. Use `value` + `onChange` for controlled mode, or rename `messages` to `initialMessages` when you only want to seed uncontrolled state.');
    }

    if (value !== undefined && persistenceKey) {
      console.warn('[Chorus] Both `value` and `persistenceKey` were provided. `value` makes the message list controlled, so built-in persistence is ignored and message changes are not saved automatically. Remove `persistenceKey` or manage persistence in your controlled state.');
    }
  }, [messages, onChange, value, persistenceKey]);

  const [draft, setDraft] = React.useState('');
  const [internalSending, setInternalSending] = React.useState(false);
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const [streamRawError, setStreamRawError] = React.useState<Error | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const fallbackErrorMessage = errorMessage ?? 'Something went wrong. Please try again.';
  const lastSubmittedTurnRef = React.useRef<SubmittedUserTurn<TMeta> | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);
  const hasStartedAssistantRef = React.useRef(false);
  const pendingAssistantIdRef = React.useRef<string | null>(null);
  const activeSessionIdRef = React.useRef(0);

  const beginAssistantSession = () => {
    activeSessionIdRef.current += 1;
    return activeSessionIdRef.current;
  };

  const isAssistantSessionActive = (sessionId: number) => activeSessionIdRef.current === sessionId;

  const invalidateAssistantSession = (sessionId?: number) => {
    if (sessionId === undefined || isAssistantSessionActive(sessionId)) {
      activeSessionIdRef.current += 1;
    }
  };

  const rememberSubmittedTurn = (text: string, history: Message<TMeta>[]) => {
    if (!findLastUserMessage(history)) return;
    lastSubmittedTurnRef.current = { text, history: cloneHistoryForRetry(history) };
  };

  const { enqueue: enqueueChunk, cancelPending } = useRAFQueue((add) => {
    const id = pendingAssistantIdRef.current;
    if (!id) return;
    updateMsgs(prev => prev.map(m => m.id === id ? { ...m, text: m.text + add } : m));
  });

  const startAssistant = (firstChunk: string) => {
    const id = createMessageId();
    pendingAssistantIdRef.current = id;
    hasStartedAssistantRef.current = true;
    cancelPending(false);
    updateMsgs(prev => prev.concat({ id, role: 'assistant', text: firstChunk }));
    onChunkRef.current?.(firstChunk, id);
  };

  const appendAssistantNow = (chunk: string) => {
    if (!chunk) return;
    if (!hasStartedAssistantRef.current) startAssistant(chunk);
    else {
      enqueueChunk(chunk);
      const id = pendingAssistantIdRef.current;
      if (id) onChunkRef.current?.(chunk, id);
    }
  };

  const finalizeAssistantNow = () => {
    cancelPending(true);
    persisted.flush();
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    setInternalSending(false);
  };

  const completeActiveSession = (sessionId: number) => {
    if (!isAssistantSessionActive(sessionId)) return false;
    finalizeAssistantNow();
    invalidateAssistantSession(sessionId);
    return true;
  };

  const createSessionHelpers = (sessionId: number, signal: AbortSignal, startedAt: number) => {
    let released = minAssistantDelayMs <= 0;
    let bufferedChunks: string[] = [];
    let finalizeRequested = false;
    let finalizeCalled = false;
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;

    const clearReleaseTimer = () => {
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
    };

    const isActive = () => isAssistantSessionActive(sessionId) && !signal.aborted;

    const flushBufferedChunks = () => {
      clearReleaseTimer();
      if (released) return;
      if (!isActive()) {
        bufferedChunks = [];
        finalizeRequested = false;
        return;
      }

      released = true;
      const chunks = bufferedChunks;
      bufferedChunks = [];
      for (const chunk of chunks) appendAssistantNow(chunk);
      if (finalizeRequested) completeActiveSession(sessionId);
    };

    const scheduleRelease = () => {
      if (released || releaseTimer !== null) return;
      const wait = Math.max(0, minAssistantDelayMs - (Date.now() - startedAt));
      if (wait <= 0) {
        flushBufferedChunks();
        return;
      }
      releaseTimer = setTimeout(flushBufferedChunks, wait);
    };

    const appendAssistant = (chunk: string) => {
      if (!chunk || !isActive()) return;

      if (released || Date.now() - startedAt >= minAssistantDelayMs) {
        if (!released) flushBufferedChunks();
        if (isActive()) appendAssistantNow(chunk);
        return;
      }

      bufferedChunks.push(chunk);
      scheduleRelease();
    };

    const requestFinalize = (forceFlush: boolean) => {
      if (!isActive()) return;

      if (!released && bufferedChunks.length > 0) {
        finalizeRequested = true;
        if (forceFlush) flushBufferedChunks();
        else scheduleRelease();
        return;
      }

      clearReleaseTimer();
      completeActiveSession(sessionId);
    };

    const finalizeAssistant = () => {
      finalizeCalled = true;
      requestFinalize(false);
    };

    const autoFinalizeAssistant = () => requestFinalize(true);

    return {
      helpers: { appendAssistant, finalizeAssistant, signal },
      hasPendingAssistant: () => bufferedChunks.length > 0 || finalizeRequested,
      hasAssistantOutput: () => hasStartedAssistantRef.current || bufferedChunks.length > 0,
      wasFinalizeRequested: () => finalizeCalled,
      autoFinalizeAssistant,
    };
  };

  const resolvedTransport = React.useMemo((): Transport<TMeta> => {
    if (typeof transport === 'string') return createFetchSSETransport<TMeta>(transport);
    if (typeof transport === 'function') return transport;
    return () => Promise.resolve(new Response(null, { status: 200 }));
  }, [transport]);

  const { send: doStream, abort: streamAbort, sending: streamSending } = useChorusStream<TMeta>(resolvedTransport, { connector });
  const sending = sendingProp ?? (transport ? streamSending : internalSending);
  const paletteVars = React.useMemo(() => styleVarsFromPalette(palette), [palette]);
  const activeStreamingMessageId = sending && hasStartedAssistantRef.current ? pendingAssistantIdRef.current : null;
  const canRenderEmptyAffordance = value !== undefined || !persistenceKey || persisted.loaded;

  const clearStreamError = React.useCallback(() => {
    setStreamError(null);
    setStreamRawError(null);
  }, []);

  const showStreamError = React.useCallback((rawError: Error | null) => {
    setStreamRawError(rawError);
    setStreamError(fallbackErrorMessage);
  }, [fallbackErrorMessage]);

  const handleSuggestedPrompt = React.useCallback((prompt: string) => {
    setDraft(prompt);

    const focusComposer = () => {
      const el = rootRef.current?.querySelector<HTMLTextAreaElement>('.chorus-input textarea');
      if (!el) return;
      el.focus();
      el.selectionStart = el.value.length;
      el.selectionEnd = el.value.length;
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusComposer);
    } else {
      focusComposer();
    }
  }, []);

  const resetStreamState = () => {
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    cancelPending(false);
  };

  const removePendingAssistant = () => {
    const partialId = pendingAssistantIdRef.current;
    resetStreamState();
    if (partialId) updateMsgs(prev => prev.filter(m => m.id !== partialId), { flushPersistence: true });
  };

  const historyForTransport = (history: Message<TMeta>[]): Message<TMeta>[] => (
    systemPrompt ? [{ id: 'chorus-system-prompt', role: 'system' as const, text: systemPrompt }, ...history] : history
  );

  const triggerAssistant = async (text: string, history: Message<TMeta>[] = msgs) => {
    const sessionId = beginAssistantSession();
    rememberSubmittedTurn(text, history);

    if (transport) {
      if (isChorusDevMode() && onSend) {
        console.warn('[Chorus] Both `transport` and `onSend` props were provided. `transport` takes precedence and `onSend` will be ignored. Remove one of the two props to silence this warning.');
      }
      resetStreamState();
      clearStreamError();
      doStream(text, historyForTransport(history), {
        onChunk: (chunk) => {
          if (isAssistantSessionActive(sessionId)) appendAssistantNow(chunk);
        },
        onDone: () => {
          completeActiveSession(sessionId);
        },
        onError: (err) => {
          if (!isAssistantSessionActive(sessionId)) return;
          removePendingAssistant();
          invalidateAssistantSession(sessionId);
          onError?.(err);
          showStreamError(err);
        },
        minDelayMs: minAssistantDelayMs,
      });
      return;
    }

    if (!onSend) {
      invalidateAssistantSession(sessionId);
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setInternalSending(true);
    clearStreamError();
    resetStreamState();

    const startedAt = Date.now();
    const sessionHelpers = createSessionHelpers(sessionId, controller.signal, startedAt);

    try {
      const res = await onSend(text, history, sessionHelpers.helpers);
      if (!isAssistantSessionActive(sessionId)) return;

      if (res && typeof res === 'object' && !hasStartedAssistantRef.current && !sessionHelpers.hasPendingAssistant()) {
        const wait = Math.max(0, minAssistantDelayMs - (Date.now() - startedAt));
        if (wait) await new Promise(r => setTimeout(r, wait));
        if (!isAssistantSessionActive(sessionId)) return;

        const returnedMessage = res as Message<TMeta>;
        updateMsgs(prev => prev.concat({
          ...returnedMessage,
          id: returnedMessage.id || createMessageId(),
          role: returnedMessage.role ?? 'assistant',
          text: returnedMessage.text ?? '',
        }));
        completeActiveSession(sessionId);
      }

      if (isAssistantSessionActive(sessionId) && sessionHelpers.hasAssistantOutput() && !sessionHelpers.wasFinalizeRequested()) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[Chorus] `onSend` appended assistant chunks but resolved without calling `helpers.finalizeAssistant()`. Chorus finalized the assistant automatically to avoid leaving the conversation in a sending state.');
        }
        sessionHelpers.autoFinalizeAssistant();
      }
    } catch (e: unknown) {
      if (isAssistantSessionActive(sessionId)) {
        removePendingAssistant();
        invalidateAssistantSession(sessionId);
        setInternalSending(false);
        if (controllerRef.current === controller) controllerRef.current = null;

        if (!isAbortError(e)) {
          const error = e instanceof Error ? e : new Error(String(e));
          onError?.(error);
          showStreamError(error);
        }
      }
    } finally {
      if (isAssistantSessionActive(sessionId) && !hasStartedAssistantRef.current && !sessionHelpers.hasPendingAssistant()) {
        completeActiveSession(sessionId);
      }
      if (controllerRef.current === controller && !isAssistantSessionActive(sessionId)) controllerRef.current = null;
    }
  };

  const send = async (attachments: Attachment[] = []) => {
    if (sending) return;
    const text = draft.trim();
    if (!text && !attachments.length) return;

    setDraft('');
    const next = updateMsgs(prev => prev.concat({ id: createMessageId(), role: 'user', text, attachments: attachments.length > 0 ? attachments : undefined }));
    await triggerAssistant(text, next);
  };

  const retry = async () => {
    const submitted = lastSubmittedTurnRef.current;
    if (!submitted || sending) return;
    if (streamError && msgs[msgs.length - 1]?.role === 'assistant') {
      updateMsgs(prev => dropTrailingAssistant(prev), { flushPersistence: true });
    }
    await triggerAssistant(submitted.text, cloneHistoryForRetry(submitted.history));
  };

  const stopActiveAssistant = () => {
    invalidateAssistantSession();
    if (transport) streamAbort();
    else controllerRef.current?.abort();
    finalizeAssistantNow();
  };

  const stop = () => {
    if (!sending) return;
    stopActiveAssistant();
  };

  const clearMessages = () => {
    if (sending) stopActiveAssistant();
    setDraft('');
    clearStreamError();
    lastSubmittedTurnRef.current = null;
    const next = resetToInitialMessages ? seedMessages : [];
    updateMsgs(() => next, { flushPersistence: true });
    onClear?.(next);
  };

  const handleEdit = async (id: string, newText: string) => {
    if (sending) return;
    const idx = msgs.findIndex(m => m.id === id);
    if (idx === -1) return;
    const edited: Message<TMeta> = { ...msgs[idx], text: newText };
    const next = updateMsgs(prev => [...prev.slice(0, idx), edited], { flushPersistence: true });
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
    const next = updateMsgs(prev => {
      const history = streamError ? dropTrailingAssistant(prev) : prev;
      return history.slice(0, userIdx + 1);
    }, { flushPersistence: true });
    await triggerAssistant(userMsg.text, next);
  };

  const handleDelete = (id: string) => updateMsgs(prev => prev.filter(m => m.id !== id), { flushPersistence: true });

  return (
    <div ref={rootRef} className={["chorus", className].filter(Boolean).join(" ")} style={{ ...paletteVars, ...style }}>
      <ChatWindow<TMeta>
        messages={msgs}
        typing={!!(transport || onSend) && sending && !hasStartedAssistantRef.current}
        codeTheme={codeBlockTheme}
        emptyState={canRenderEmptyAffordance ? emptyState : undefined}
        error={streamError}
        headless={headless}
        hiddenRoles={hiddenRoles}
        markdownProps={markdownProps}
        markdownSanitizer={markdownSanitizer}
        maxRenderedMessages={maxRenderedMessages}
        onDelete={handleDelete}
        onDismissError={clearStreamError}
        onEdit={(transport || onSend) ? handleEdit : undefined}
        onRegenerate={(transport || onSend) ? handleRegenerate : undefined}
        onRetry={retry}
        onSuggestedPrompt={handleSuggestedPrompt}
        rawError={streamRawError}
        renderError={renderError}
        renderMessage={renderMessage}
        showJumpToBottomButton={showJumpToBottomButton}
        streamingMessageId={activeStreamingMessageId}
        suggestedPrompts={canRenderEmptyAffordance ? suggestedPrompts : undefined}
      />
      {showClearButton && (
        <div className="chorus-clear-row">
          <button type="button" className="chorus-clear-btn" onClick={clearMessages} disabled={!sending && msgs.length === 0}>
            {clearLabel}
          </button>
        </div>
      )}
      <ChatInput
        value={draft}
        onChange={setDraft}
        onSend={send}
        onStop={stop}
        sending={sending}
        placeholder={placeholder}
        accept={accept}
        maxAttachmentBytes={maxAttachmentBytes}
        maxAttachments={maxAttachments}
        onAttachmentError={onAttachmentError}
        uploadAttachment={uploadAttachment}
      />
    </div>
  );
}

export default Chorus;
