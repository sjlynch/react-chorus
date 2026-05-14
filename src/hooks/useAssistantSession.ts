import React from 'react';
import type { Attachment, ConnectorName, Message } from '../types';
import type { Connector, ConnectorToolDelta } from '../connectors/connectors';
import { useChorusStream, type Transport } from './useChorusStream';
import { createFetchSSETransport } from '../streaming/createFetchSSETransport';
import { useRAFQueue } from './useRAFQueue';
import { useLatestRef } from './useLatestRef';
import { isChorusDevMode } from '../utils/devMode';

export interface ChorusSendHelpers {
  appendAssistant: (chunk: string) => void;
  finalizeAssistant: () => void;
  signal: AbortSignal;
  /** The optional `systemPrompt` prop. Use it in custom `onSend` request mapping; it is not prepended to `messages` on the onSend path. */
  systemPrompt?: string;
}

export type ChorusOnSend<TMeta = Record<string, unknown>> = (
  text: string,
  messages: Message<TMeta>[],
  helpers: ChorusSendHelpers,
) => Promise<Message<TMeta> | void> | Message<TMeta> | void;

export interface ChorusFinishContext<TMeta = Record<string, unknown>> {
  message: Message<TMeta>;
  messages: Message<TMeta>[];
  reason: 'done' | 'returned-message';
  response?: Response;
}

export type ChorusOnFinish<TMeta = Record<string, unknown>> = (context: ChorusFinishContext<TMeta>) => void;

interface UpdateMessagesOptions {
  flushPersistence?: boolean;
  removePersistenceIfEmpty?: boolean;
}

interface SubmittedUserTurn<TMeta = Record<string, unknown>> {
  text: string;
  history: Message<TMeta>[];
}

export interface UseAssistantSessionOptions<TMeta = Record<string, unknown>> {
  messages: Message<TMeta>[];
  updateMessages: (updater: (prev: Message<TMeta>[]) => Message<TMeta>[], options?: UpdateMessagesOptions) => Message<TMeta>[];
  seedMessages: Message<TMeta>[];
  transport?: string | Transport<TMeta>;
  systemPrompt?: string;
  connector?: Connector | ConnectorName;
  onSend?: ChorusOnSend<TMeta>;
  minAssistantDelayMs: number;
  fallbackErrorMessage: string;
  onError?: (error: Error) => void;
  onChunkRef: React.MutableRefObject<((chunk: string, messageId: string) => void) | undefined>;
  onFinish?: ChorusOnFinish<TMeta>;
  flushPersistence: () => void;
  resetToInitialMessages?: boolean;
  onClear?: (messages: Message<TMeta>[]) => void;
}

export interface UseAssistantSessionResult {
  send: (text: string, attachments?: Attachment[]) => boolean;
  retry: () => void;
  stop: () => void;
  clear: () => void;
  dismissError: () => void;
  handleEdit: (id: string, newText: string) => void;
  handleRegenerate: (id: string) => void;
  handleDelete: (id: string) => void;
  sending: boolean;
  streamError: string | null;
  streamRawError: Error | null;
  streamingMessageId: string | null;
  hasStartedAssistant: boolean;
}

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

function warnObserverError(callbackName: string, error: unknown) {
  if (!isChorusDevMode()) return;
  console.warn(`[Chorus] \`${callbackName}\` callback threw and was ignored so it could not interrupt message rendering.`, error);
}

export function useAssistantSession<TMeta = Record<string, unknown>>({
  messages,
  updateMessages,
  seedMessages,
  transport,
  systemPrompt,
  connector,
  onSend,
  minAssistantDelayMs,
  fallbackErrorMessage,
  onError,
  onChunkRef,
  onFinish,
  flushPersistence,
  resetToInitialMessages = false,
  onClear,
}: UseAssistantSessionOptions<TMeta>): UseAssistantSessionResult {
  const messagesRef = useLatestRef(messages);
  const transportRef = useLatestRef(transport);
  const onSendRef = useLatestRef(onSend);
  const onErrorRef = useLatestRef(onError);
  const onFinishRef = useLatestRef(onFinish);
  const onClearRef = useLatestRef(onClear);
  const fallbackErrorMessageRef = useLatestRef(fallbackErrorMessage);
  const systemPromptRef = useLatestRef(systemPrompt);
  const minAssistantDelayMsRef = useLatestRef(minAssistantDelayMs);
  const seedMessagesRef = useLatestRef(seedMessages);

  const [internalSending, setInternalSendingState] = React.useState(false);
  const [transportBusy, setTransportBusyState] = React.useState(false);
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const [streamRawError, setStreamRawError] = React.useState<Error | null>(null);
  const [, forceRender] = React.useReducer((value: number) => value + 1, 0);

  const clearStreamError = React.useCallback(() => {
    setStreamError(null);
    setStreamRawError(null);
  }, []);

  const showStreamError = React.useCallback((rawError: Error | null) => {
    setStreamRawError(rawError);
    setStreamError(fallbackErrorMessageRef.current);
  }, [fallbackErrorMessageRef]);

  const internalSendingRef = React.useRef(false);
  const transportBusyRef = React.useRef(false);
  const lastSubmittedTurnRef = React.useRef<SubmittedUserTurn<TMeta> | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);
  const hasStartedAssistantRef = React.useRef(false);
  const pendingAssistantIdRef = React.useRef<string | null>(null);
  const pendingToolMessageIdsRef = React.useRef<Set<string>>(new Set());
  const toolMessageIdsByDeltaIdRef = React.useRef<Map<string, string>>(new Map());
  const activeSessionIdRef = React.useRef(0);
  const warnedMissingHandlerRef = React.useRef(false);
  const warnedTransportOnSendRef = React.useRef(false);

  const updateSessionMessages = React.useCallback((
    updater: (prev: Message<TMeta>[]) => Message<TMeta>[],
    options?: UpdateMessagesOptions,
  ) => {
    const next = updateMessages(updater, options);
    messagesRef.current = next;
    return next;
  }, [messagesRef, updateMessages]);

  const safeOnChunk = React.useCallback((chunk: string, messageId: string) => {
    try {
      onChunkRef.current?.(chunk, messageId);
    } catch (error) {
      warnObserverError('onChunk', error);
    }
  }, [onChunkRef]);

  const safeOnError = React.useCallback((error: Error) => {
    try {
      onErrorRef.current?.(error);
    } catch (callbackError) {
      warnObserverError('onError', callbackError);
    }
  }, [onErrorRef]);

  const safeOnFinish = React.useCallback((context: ChorusFinishContext<TMeta>) => {
    try {
      onFinishRef.current?.(context);
    } catch (error) {
      warnObserverError('onFinish', error);
    }
  }, [onFinishRef]);

  const setInternalSending = React.useCallback((next: boolean) => {
    internalSendingRef.current = next;
    setInternalSendingState(next);
  }, []);

  const setTransportBusy = React.useCallback((next: boolean) => {
    transportBusyRef.current = next;
    setTransportBusyState(next);
  }, []);

  const beginAssistantSession = React.useCallback(() => {
    activeSessionIdRef.current += 1;
    return activeSessionIdRef.current;
  }, []);

  const isAssistantSessionActive = React.useCallback((sessionId: number) => activeSessionIdRef.current === sessionId, []);

  const invalidateAssistantSession = React.useCallback((sessionId?: number) => {
    if (sessionId === undefined || activeSessionIdRef.current === sessionId) {
      activeSessionIdRef.current += 1;
    }
  }, []);

  const rememberSubmittedTurn = React.useCallback((text: string, history: Message<TMeta>[]) => {
    if (!findLastUserMessage(history)) return;
    lastSubmittedTurnRef.current = { text, history: cloneHistoryForRetry(history) };
  }, []);

  const { enqueue: enqueueTextChunk, cancelPending: cancelPendingText } = useRAFQueue((add) => {
    const id = pendingAssistantIdRef.current;
    if (!id) return;
    updateSessionMessages(prev => prev.map(m => m.id === id ? { ...m, text: m.text + add } : m));
  });

  const { enqueue: enqueueReasoningChunk, cancelPending: cancelPendingReasoning } = useRAFQueue((add) => {
    const id = pendingAssistantIdRef.current;
    if (!id) return;
    updateSessionMessages(prev => prev.map(m => m.id === id ? { ...m, reasoning: `${m.reasoning ?? ''}${add}` } : m));
  });

  const cancelPending = React.useCallback((flushPending: boolean) => {
    cancelPendingText(flushPending);
    cancelPendingReasoning(flushPending);
  }, [cancelPendingText, cancelPendingReasoning]);

  const resetStreamState = React.useCallback(() => {
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    pendingToolMessageIdsRef.current.clear();
    toolMessageIdsByDeltaIdRef.current.clear();
    cancelPending(false);
    forceRender();
  }, [cancelPending]);

  const startAssistant = React.useCallback(({ text = '', reasoning }: { text?: string; reasoning?: string }) => {
    const id = createMessageId();
    pendingAssistantIdRef.current = id;
    hasStartedAssistantRef.current = true;
    cancelPending(false);
    updateSessionMessages(prev => prev.concat({ id, role: 'assistant', text, reasoning }));
    if (text) safeOnChunk(text, id);
    forceRender();
  }, [cancelPending, safeOnChunk, updateSessionMessages]);

  const appendAssistantNow = React.useCallback((chunk: string) => {
    if (!chunk) return;
    if (!hasStartedAssistantRef.current) startAssistant({ text: chunk });
    else {
      enqueueTextChunk(chunk);
      const id = pendingAssistantIdRef.current;
      if (id) safeOnChunk(chunk, id);
    }
  }, [enqueueTextChunk, safeOnChunk, startAssistant]);

  const appendAssistantReasoningNow = React.useCallback((chunk: string) => {
    if (!chunk) return;
    if (!hasStartedAssistantRef.current) startAssistant({ reasoning: chunk });
    else enqueueReasoningChunk(chunk);
  }, [enqueueReasoningChunk, startAssistant]);

  const toolMessageIdForDelta = React.useCallback((deltaId: string) => {
    const existing = toolMessageIdsByDeltaIdRef.current.get(deltaId);
    if (existing) return existing;
    const next = createMessageId();
    toolMessageIdsByDeltaIdRef.current.set(deltaId, next);
    return next;
  }, []);

  const appendToolDeltaNow = React.useCallback((delta: ConnectorToolDelta) => {
    const messageId = toolMessageIdForDelta(delta.id);
    pendingToolMessageIdsRef.current.add(messageId);
    updateSessionMessages(prev => {
      const idx = prev.findIndex(m => m.id === messageId);
      const existing = idx >= 0 ? prev[idx] : undefined;
      const toolCall = {
        ...(existing?.toolCall ?? {}),
        name: delta.name ?? existing?.toolCall?.name ?? delta.id,
      };
      if (Object.prototype.hasOwnProperty.call(delta, 'input')) toolCall.input = delta.input;
      if (Object.prototype.hasOwnProperty.call(delta, 'output')) toolCall.output = delta.output;

      const nextMessage: Message<TMeta> = existing
        ? { ...existing, role: 'tool', text: existing.text ?? '', toolCall }
        : { id: messageId, role: 'tool', text: '', toolCall };

      if (idx >= 0) return prev.map(m => m.id === messageId ? nextMessage : m);
      return prev.concat(nextMessage);
    });
  }, [toolMessageIdForDelta, updateSessionMessages]);

  const finalizeAssistantNow = React.useCallback(() => {
    cancelPending(true);
    flushPersistence();
    const id = pendingAssistantIdRef.current;
    const message = id ? messagesRef.current.find(m => m.id === id) ?? null : null;
    hasStartedAssistantRef.current = false;
    pendingAssistantIdRef.current = null;
    pendingToolMessageIdsRef.current.clear();
    toolMessageIdsByDeltaIdRef.current.clear();
    setInternalSending(false);
    forceRender();
    return message;
  }, [cancelPending, flushPersistence, messagesRef, setInternalSending]);

  const completeActiveSession = React.useCallback((
    sessionId: number,
    finish?: { reason: ChorusFinishContext<TMeta>['reason']; response?: Response; message?: Message<TMeta> },
  ) => {
    if (!isAssistantSessionActive(sessionId)) return false;

    const message = finish?.message ?? finalizeAssistantNow();
    if (finish?.message) {
      cancelPending(true);
      flushPersistence();
      hasStartedAssistantRef.current = false;
      pendingAssistantIdRef.current = null;
      pendingToolMessageIdsRef.current.clear();
      toolMessageIdsByDeltaIdRef.current.clear();
      setInternalSending(false);
      forceRender();
    }

    invalidateAssistantSession(sessionId);
    if (finish && message) {
      safeOnFinish({
        message,
        messages: messagesRef.current,
        reason: finish.reason,
        response: finish.response,
      });
    }
    return true;
  }, [cancelPending, finalizeAssistantNow, flushPersistence, invalidateAssistantSession, isAssistantSessionActive, messagesRef, safeOnFinish, setInternalSending]);

  const createSessionHelpers = React.useCallback((sessionId: number, signal: AbortSignal, startedAt: number) => {
    let released = minAssistantDelayMsRef.current <= 0;
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
      if (finalizeRequested) completeActiveSession(sessionId, { reason: 'done' });
    };

    const scheduleRelease = () => {
      if (released || releaseTimer !== null) return;
      const wait = Math.max(0, minAssistantDelayMsRef.current - (Date.now() - startedAt));
      if (wait <= 0) {
        flushBufferedChunks();
        return;
      }
      releaseTimer = setTimeout(flushBufferedChunks, wait);
    };

    const appendAssistant = (chunk: string) => {
      if (!chunk || !isActive()) return;

      if (released || Date.now() - startedAt >= minAssistantDelayMsRef.current) {
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
      completeActiveSession(sessionId, { reason: 'done' });
    };

    const finalizeAssistant = () => {
      finalizeCalled = true;
      requestFinalize(false);
    };

    const autoFinalizeAssistant = () => requestFinalize(true);

    return {
      helpers: { appendAssistant, finalizeAssistant, signal, systemPrompt: systemPromptRef.current },
      hasPendingAssistant: () => bufferedChunks.length > 0 || finalizeRequested,
      hasAssistantOutput: () => hasStartedAssistantRef.current || bufferedChunks.length > 0,
      wasFinalizeRequested: () => finalizeCalled,
      autoFinalizeAssistant,
    };
  }, [appendAssistantNow, completeActiveSession, isAssistantSessionActive, minAssistantDelayMsRef, systemPromptRef]);

  const resolvedTransport = React.useMemo((): Transport<TMeta> => {
    if (typeof transport === 'string') return createFetchSSETransport<TMeta>(transport);
    if (typeof transport === 'function') return transport;
    return () => Promise.resolve(new Response(null, { status: 200 }));
  }, [transport]);

  const { send: doStream, abort: streamAbort, sending: streamSending } = useChorusStream<TMeta>(resolvedTransport, { connector });
  const streamSendingRef = useLatestRef(streamSending);
  const sending = transport ? (streamSending || transportBusy) : internalSending;

  const isBusy = React.useCallback(() => (
    transportRef.current
      ? streamSendingRef.current || transportBusyRef.current
      : internalSendingRef.current
  ), [streamSendingRef, transportRef]);

  const removePendingAssistant = React.useCallback(() => {
    const partialId = pendingAssistantIdRef.current;
    const toolMessageIds = new Set(pendingToolMessageIdsRef.current);
    resetStreamState();
    if (partialId || toolMessageIds.size > 0) {
      updateSessionMessages(prev => prev.filter(m => m.id !== partialId && !toolMessageIds.has(m.id)), { flushPersistence: true });
    }
  }, [resetStreamState, updateSessionMessages]);

  const historyForTransport = React.useCallback((history: Message<TMeta>[]): Message<TMeta>[] => (
    systemPromptRef.current
      ? [{ id: 'chorus-system-prompt', role: 'system' as const, text: systemPromptRef.current }, ...history]
      : history
  ), [systemPromptRef]);

  const triggerAssistant = React.useCallback((text: string, history: Message<TMeta>[] = messagesRef.current) => {
    const sessionId = beginAssistantSession();
    rememberSubmittedTurn(text, history);
    const currentTransport = transportRef.current;
    const currentOnSend = onSendRef.current;

    if (currentTransport) {
      if (isChorusDevMode() && currentOnSend && !warnedTransportOnSendRef.current) {
        warnedTransportOnSendRef.current = true;
        console.warn('[Chorus] Both `transport` and `onSend` props were provided. `transport` takes precedence and `onSend` will be ignored. Remove one of the two props to silence this warning.');
      }
      resetStreamState();
      clearStreamError();
      setTransportBusy(true);
      void doStream(text, historyForTransport(history), {
        onChunk: (chunk) => {
          if (isAssistantSessionActive(sessionId)) appendAssistantNow(chunk);
        },
        onReasoning: (chunk) => {
          if (isAssistantSessionActive(sessionId)) appendAssistantReasoningNow(chunk);
        },
        onToolDelta: (delta) => {
          if (isAssistantSessionActive(sessionId)) appendToolDeltaNow(delta);
        },
        onDone: (response) => {
          if (!isAssistantSessionActive(sessionId)) return;
          completeActiveSession(sessionId, { reason: 'done', response });
          setTransportBusy(false);
        },
        onError: (err) => {
          if (!isAssistantSessionActive(sessionId)) return;
          removePendingAssistant();
          invalidateAssistantSession(sessionId);
          setTransportBusy(false);
          safeOnError(err);
          showStreamError(err);
        },
        minDelayMs: minAssistantDelayMsRef.current,
      }).catch(() => {
        setTransportBusy(false);
      });
      return;
    }

    if (!currentOnSend) {
      invalidateAssistantSession(sessionId);
      if (isChorusDevMode() && !warnedMissingHandlerRef.current) {
        warnedMissingHandlerRef.current = true;
        console.warn('[Chorus] `send` was called but neither `transport` nor `onSend` was provided. Pass one of these props to produce an assistant response.');
      }
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

    void (async () => {
      try {
        const res = await currentOnSend(text, history, sessionHelpers.helpers);
        if (!isAssistantSessionActive(sessionId)) return;

        if (res && typeof res === 'object' && !hasStartedAssistantRef.current && !sessionHelpers.hasPendingAssistant()) {
          const wait = Math.max(0, minAssistantDelayMsRef.current - (Date.now() - startedAt));
          if (wait) await new Promise(r => setTimeout(r, wait));
          if (!isAssistantSessionActive(sessionId)) return;

          const returnedMessage = res as Partial<Message<TMeta>>;
          const normalizedMessage: Message<TMeta> = {
            ...(returnedMessage as Message<TMeta>),
            id: returnedMessage.id || createMessageId(),
            role: returnedMessage.role ?? 'assistant',
            text: returnedMessage.text ?? '',
          };
          updateSessionMessages(prev => prev.concat(normalizedMessage));
          completeActiveSession(sessionId, { reason: 'returned-message', message: normalizedMessage });
        }

        if (isAssistantSessionActive(sessionId) && sessionHelpers.hasAssistantOutput() && !sessionHelpers.wasFinalizeRequested()) {
          if (isChorusDevMode()) {
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
            safeOnError(error);
            showStreamError(error);
          }
        }
      } finally {
        if (isAssistantSessionActive(sessionId) && !hasStartedAssistantRef.current && !sessionHelpers.hasPendingAssistant()) {
          completeActiveSession(sessionId);
        }
        if (controllerRef.current === controller && !isAssistantSessionActive(sessionId)) controllerRef.current = null;
      }
    })();
  }, [appendAssistantNow, appendAssistantReasoningNow, appendToolDeltaNow, beginAssistantSession, clearStreamError, completeActiveSession, createSessionHelpers, doStream, historyForTransport, invalidateAssistantSession, isAssistantSessionActive, minAssistantDelayMsRef, messagesRef, onSendRef, rememberSubmittedTurn, removePendingAssistant, resetStreamState, safeOnError, setInternalSending, setTransportBusy, showStreamError, transportRef, updateSessionMessages]);

  const send = React.useCallback((rawText: string, attachments: Attachment[] = []) => {
    if (isBusy()) return false;
    const text = rawText.trim();
    if (!text && !attachments.length) return false;

    const next = updateSessionMessages(prev => prev.concat({
      id: createMessageId(),
      role: 'user',
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
    }));
    triggerAssistant(text, next);
    return true;
  }, [isBusy, triggerAssistant, updateSessionMessages]);

  const retry = React.useCallback(() => {
    const submitted = lastSubmittedTurnRef.current;
    if (!submitted || isBusy()) return;
    if (streamError && messagesRef.current[messagesRef.current.length - 1]?.role === 'assistant') {
      updateSessionMessages(prev => dropTrailingAssistant(prev), { flushPersistence: true });
    }
    triggerAssistant(submitted.text, cloneHistoryForRetry(submitted.history));
  }, [isBusy, messagesRef, streamError, triggerAssistant, updateSessionMessages]);

  const stopActiveAssistant = React.useCallback(() => {
    invalidateAssistantSession();
    if (transportRef.current) {
      streamAbort();
      setTransportBusy(false);
    } else {
      controllerRef.current?.abort();
    }
    finalizeAssistantNow();
  }, [finalizeAssistantNow, invalidateAssistantSession, setTransportBusy, streamAbort, transportRef]);

  const stop = React.useCallback(() => {
    if (!isBusy()) return;
    stopActiveAssistant();
  }, [isBusy, stopActiveAssistant]);

  const clear = React.useCallback(() => {
    if (isBusy()) stopActiveAssistant();
    clearStreamError();
    lastSubmittedTurnRef.current = null;
    const next = resetToInitialMessages ? seedMessagesRef.current : [];
    updateSessionMessages(() => next, { flushPersistence: true, removePersistenceIfEmpty: !resetToInitialMessages });
    onClearRef.current?.(next);
  }, [clearStreamError, isBusy, onClearRef, resetToInitialMessages, seedMessagesRef, stopActiveAssistant, updateSessionMessages]);

  const handleEdit = React.useCallback((id: string, newText: string) => {
    if (isBusy()) return;
    const currentMessages = messagesRef.current;
    const idx = currentMessages.findIndex(m => m.id === id);
    if (idx === -1) return;
    const edited: Message<TMeta> = { ...currentMessages[idx], text: newText };
    const next = updateSessionMessages(prev => [...prev.slice(0, idx), edited], { flushPersistence: true });
    triggerAssistant(newText, next);
  }, [isBusy, messagesRef, triggerAssistant, updateSessionMessages]);

  const handleRegenerate = React.useCallback((id: string) => {
    if (isBusy()) return;
    const currentMessages = messagesRef.current;
    const idx = currentMessages.findIndex(m => m.id === id);
    if (idx === -1) return;
    let userIdx = idx - 1;
    while (userIdx >= 0 && currentMessages[userIdx].role !== 'user') userIdx -= 1;
    if (userIdx < 0) return;
    const userMsg = currentMessages[userIdx];
    const next = updateSessionMessages(prev => {
      const history = streamError ? dropTrailingAssistant(prev) : prev;
      return history.slice(0, userIdx + 1);
    }, { flushPersistence: true });
    triggerAssistant(userMsg.text, next);
  }, [isBusy, messagesRef, streamError, triggerAssistant, updateSessionMessages]);

  const handleDelete = React.useCallback((id: string) => {
    updateSessionMessages(prev => prev.filter(m => m.id !== id), { flushPersistence: true });
  }, [updateSessionMessages]);

  const streamingMessageId = sending && hasStartedAssistantRef.current ? pendingAssistantIdRef.current : null;

  return {
    send,
    retry,
    stop,
    clear,
    dismissError: clearStreamError,
    handleEdit,
    handleRegenerate,
    handleDelete,
    sending,
    streamError,
    streamRawError,
    streamingMessageId,
    hasStartedAssistant: hasStartedAssistantRef.current,
  };
}
