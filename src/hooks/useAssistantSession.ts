import React from 'react';
import type { Attachment, Message } from '../types';
import type { Connector } from '../connectors/connectors';
import type { ConnectorName } from '../types';
import { useChorusStream, type Transport } from './useChorusStream';
import { useLatestRef } from './useLatestRef';
import { isChorusDevMode } from '../utils/devMode';
import { isAbortError } from '../utils/errors';
import { isPromiseLike } from '../utils/async';
import { createDefaultFetchSSETransport, type FetchTransportInit } from './assistant-session/transport';
import { cloneHistoryForRetry, createMessageId, dropTrailingAssistant, findLastUserMessage, normalizeReturnedMessage } from './assistant-session/messageUtils';
import { warnObserverError } from './assistant-session/observer';
import { DEFAULT_MAX_TOOL_ITERATIONS } from './assistant-session/toolLoop';
import { createObserverCallbacks } from './assistant-session/observerCallbacks';
import { useAssistantBuffer } from './assistant-session/assistantBuffer';
import { useToolExecution } from './assistant-session/toolExecution';
import { createSessionHelpers } from './assistant-session/sessionHelpers';
import { useTransportLifecycle, type DoStream } from './assistant-session/transportLifecycle';
import type { ChorusToolRegistry } from '../tools';
import type {
  ChorusAbortSource,
  ChorusClearConversationContext,
  ChorusConfirmClearConversation,
  ChorusConfirmDeleteMessage,
  ChorusFinishContext,
  ChorusOnAbort,
  ChorusOnFinish,
  ChorusOnSend,
  ChorusOnStreamDone,
  ChorusOnToolCall,
  ChorusOnToolDelta,
  ChorusSendPath,
  ChorusShouldContinueToolLoop,
  SubmittedUserTurn,
  UpdateMessagesOptions,
} from './assistant-session/types';

export type {
  ChorusAbortContext,
  ChorusAbortReason,
  ChorusAbortSource,
  ChorusClearConversationContext,
  ChorusConfirmClearConversation,
  ChorusConfirmDeleteMessage,
  ChorusDeleteMessageContext,
  ChorusFinishContext,
  ChorusOnAbort,
  ChorusOnFinish,
  ChorusOnSend,
  ChorusOnStreamDone,
  ChorusOnToolCall,
  ChorusOnToolDelta,
  ChorusSendHelpers,
  ChorusSendPath,
  ChorusShouldContinueToolLoop,
  ChorusStreamDoneContext,
  ChorusStreamDoneReason,
  ChorusToolCallContext,
  ChorusToolDeltaContext,
  ChorusToolHandler,
  ChorusToolLoopContext,
} from './assistant-session/types';
export type { ChorusToolRegistry };

export interface UseAssistantSessionOptions<TMeta = Record<string, unknown>> {
  messages: Message<TMeta>[];
  updateMessages: (updater: (prev: Message<TMeta>[]) => Message<TMeta>[], options?: UpdateMessagesOptions) => Message<TMeta>[];
  seedMessages: Message<TMeta>[];
  transport?: string | FetchTransportInit<TMeta> | Transport<TMeta>;
  systemPrompt?: string;
  connector?: Connector | ConnectorName;
  onSend?: ChorusOnSend<TMeta>;
  minAssistantDelayMs: number;
  fallbackErrorMessage: string;
  onError?: (error: Error) => void;
  onChunkRef: React.MutableRefObject<((chunk: string, messageId: string) => void) | undefined>;
  onFinish?: ChorusOnFinish<TMeta>;
  onAbort?: ChorusOnAbort<TMeta>;
  onStreamDone?: ChorusOnStreamDone<TMeta>;
  onToolCall?: ChorusOnToolCall<TMeta>;
  onToolDelta?: ChorusOnToolDelta<TMeta>;
  tools?: ChorusToolRegistry<TMeta>;
  autoContinueTools?: boolean;
  maxToolIterations?: number;
  shouldContinueToolLoop?: ChorusShouldContinueToolLoop<TMeta>;
  confirmDeleteMessage?: ChorusConfirmDeleteMessage<TMeta>;
  confirmClearConversation?: ChorusConfirmClearConversation<TMeta>;
  persistenceKey?: string;
  flushPersistence: () => void;
  resetToInitialMessages?: boolean;
  onClear?: (messages: Message<TMeta>[]) => void;
}

export interface UseAssistantSessionResult {
  send: (text: string, attachments?: Attachment[]) => boolean;
  retry: () => void;
  stop: (source?: ChorusAbortSource) => void;
  clear: (source?: ChorusAbortSource) => void;
  dismissError: () => void;
  handleEdit: (id: string, newText: string) => void;
  handleRegenerate: (id: string) => void;
  handleDelete: (id: string) => void;
  sending: boolean;
  streamError: string | null;
  streamRawError: Error | null;
  streamingMessageId: string | null;
  hasStartedAssistant: boolean;
  clearConfirmationPending: boolean;
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
  onAbort,
  onStreamDone,
  onToolCall,
  onToolDelta,
  tools,
  autoContinueTools = false,
  maxToolIterations = DEFAULT_MAX_TOOL_ITERATIONS,
  shouldContinueToolLoop,
  confirmDeleteMessage,
  confirmClearConversation,
  persistenceKey,
  flushPersistence,
  resetToInitialMessages = false,
  onClear,
}: UseAssistantSessionOptions<TMeta>): UseAssistantSessionResult {
  const messagesRef = useLatestRef(messages);
  const transportRef = useLatestRef(transport);
  const onSendRef = useLatestRef(onSend);
  const onErrorRef = useLatestRef(onError);
  const onFinishRef = useLatestRef(onFinish);
  const onAbortRef = useLatestRef(onAbort);
  const onStreamDoneRef = useLatestRef(onStreamDone);
  const onToolCallRef = useLatestRef(onToolCall);
  const onToolDeltaRef = useLatestRef(onToolDelta);
  const toolsRef = useLatestRef(tools);
  const autoContinueToolsRef = useLatestRef(autoContinueTools);
  const maxToolIterationsRef = useLatestRef(maxToolIterations);
  const shouldContinueToolLoopRef = useLatestRef(shouldContinueToolLoop);
  const confirmDeleteMessageRef = useLatestRef(confirmDeleteMessage);
  const confirmClearConversationRef = useLatestRef(confirmClearConversation);
  const persistenceKeyRef = useLatestRef(persistenceKey);
  const resetToInitialMessagesRef = useLatestRef(resetToInitialMessages);
  const onClearRef = useLatestRef(onClear);
  const fallbackErrorMessageRef = useLatestRef(fallbackErrorMessage);
  const systemPromptRef = useLatestRef(systemPrompt);
  const minAssistantDelayMsRef = useLatestRef(minAssistantDelayMs);
  const seedMessagesRef = useLatestRef(seedMessages);
  const pendingDeleteIdsRef = React.useRef(new Set<string>());
  const clearConfirmationActiveRef = React.useRef(false);

  const [clearConfirmationPending, setClearConfirmationPending] = React.useState(false);
  const [internalSending, setInternalSendingState] = React.useState(false);
  const [transportBusy, setTransportBusyState] = React.useState(false);
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const [streamRawError, setStreamRawError] = React.useState<Error | null>(null);
  const [, forceRenderImpl] = React.useReducer((value: number) => value + 1, 0);
  const forceRender = forceRenderImpl as () => void;

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
  const activeSessionIdRef = React.useRef(0);
  const activeSendPathRef = React.useRef<ChorusSendPath | null>(null);
  const warnedMissingHandlerRef = React.useRef(false);
  const warnedTransportOnSendRef = React.useRef(false);

  const warnMissingResponseHandler = React.useCallback(() => {
    if (isChorusDevMode() && !warnedMissingHandlerRef.current) {
      warnedMissingHandlerRef.current = true;
      console.warn('[Chorus] `send` was called but neither `transport` nor `onSend` was provided. Pass one of these props to produce an assistant response.');
    }
  }, []);

  const updateSessionMessages = React.useCallback((
    updater: (prev: Message<TMeta>[]) => Message<TMeta>[],
    options?: UpdateMessagesOptions,
  ) => {
    const next = updateMessages(updater, options);
    messagesRef.current = next;
    return next;
  }, [messagesRef, updateMessages]);

  const observers = React.useMemo(() => createObserverCallbacks<TMeta>({
    onChunkRef,
    onErrorRef,
    onFinishRef,
    onAbortRef,
    onStreamDoneRef,
    onToolDeltaRef,
    onToolCallRef,
  }), [onAbortRef, onChunkRef, onErrorRef, onFinishRef, onStreamDoneRef, onToolCallRef, onToolDeltaRef]);

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
      activeSendPathRef.current = null;
    }
  }, []);

  const rememberSubmittedTurn = React.useCallback((text: string, history: Message<TMeta>[]) => {
    if (!findLastUserMessage(history)) return;
    lastSubmittedTurnRef.current = { text, history: cloneHistoryForRetry(history) };
  }, []);

  const buffer = useAssistantBuffer<TMeta>({
    updateSessionMessages,
    flushPersistence,
    messagesRef,
    safeOnChunk: observers.safeOnChunk,
    setInternalSending,
    forceRender,
  });
  const {
    pendingAssistantIdRef,
    pendingToolMessageIdsRef,
    toolMessageIdsByDeltaIdRef,
    hasStartedAssistantRef,
    cancelPending,
    resetPendingAssistantState,
    resetStreamState,
    appendAssistantNow,
    appendAssistantReasoningNow,
    finalizeAssistantNow,
  } = buffer;

  const toolExec = useToolExecution<TMeta>({
    updateSessionMessages,
    messagesRef,
    pendingToolMessageIdsRef,
    toolMessageIdsByDeltaIdRef,
    hasStartedAssistantRef,
    toolsRef,
    onToolCallRef,
    safeOnToolDelta: observers.safeOnToolDelta,
    safeNotifyToolCall: observers.safeNotifyToolCall,
    isAssistantSessionActive,
    forceRender,
  });
  const { appendToolDeltaNow, getToolMessagesByIds, runCompletedToolCalls } = toolExec;

  const completeActiveSession = React.useCallback((
    sessionId: number,
    finish?: { reason: ChorusFinishContext<TMeta>['reason']; response?: Response; message?: Message<TMeta> },
  ) => {
    if (!isAssistantSessionActive(sessionId)) return null;

    const message = finish?.message ?? finalizeAssistantNow();
    if (finish?.message) {
      resetPendingAssistantState();
      setInternalSending(false);
      forceRender();
    }

    invalidateAssistantSession(sessionId);
    if (finish && message) {
      observers.safeOnFinish({
        message,
        messages: messagesRef.current,
        reason: finish.reason,
        response: finish.response,
      });
    }
    return message;
  }, [finalizeAssistantNow, forceRender, invalidateAssistantSession, isAssistantSessionActive, messagesRef, observers, resetPendingAssistantState, setInternalSending]);

  const resolvedTransport = React.useMemo((): Transport<TMeta> => {
    if (typeof transport === 'string') return createDefaultFetchSSETransport<TMeta>(transport);
    if (typeof transport === 'function') return transport;
    if (transport && typeof transport === 'object' && typeof transport.url === 'string') {
      return createDefaultFetchSSETransport<TMeta>(transport);
    }
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
      updateSessionMessages(prev => prev.filter(m => m.id !== partialId && !toolMessageIds.has(m.id)), { flushPersistence: true, reason: 'delete' });
    }
  }, [pendingAssistantIdRef, pendingToolMessageIdsRef, resetStreamState, updateSessionMessages]);

  const transportLifecycle = useTransportLifecycle<TMeta>({
    controllerRef,
    messagesRef,
    pendingToolMessageIdsRef,
    autoContinueToolsRef,
    maxToolIterationsRef,
    shouldContinueToolLoopRef,
    systemPromptRef,
    minAssistantDelayMsRef,
    isAssistantSessionActive,
    invalidateAssistantSession,
    removePendingAssistant,
    setTransportBusy,
    appendAssistantNow,
    appendAssistantReasoningNow,
    appendToolDeltaNow,
    finalizeAssistantNow,
    resetPendingAssistantState,
    getToolMessagesByIds,
    runCompletedToolCalls,
    showStreamError,
    observers,
    doStream: doStream as DoStream<TMeta>,
    forceRender,
  });
  const { startTransportStream } = transportLifecycle;

  const abortActiveAssistant = React.useCallback((reason: import('./assistant-session/types').ChorusAbortReason, source: ChorusAbortSource) => {
    const path = activeSendPathRef.current ?? (transportRef.current ? 'transport' : 'onSend');

    invalidateAssistantSession();
    controllerRef.current?.abort();
    if (path === 'transport') {
      streamAbort();
      setTransportBusy(false);
    }
    controllerRef.current = null;

    const message = finalizeAssistantNow();
    observers.safeOnAbort({
      message,
      messages: messagesRef.current,
      reason,
      source,
      path,
    });
  }, [finalizeAssistantNow, invalidateAssistantSession, messagesRef, observers, setTransportBusy, streamAbort, transportRef]);

  const triggerAssistant = React.useCallback((text: string, history: Message<TMeta>[] = messagesRef.current) => {
    if (activeSendPathRef.current) abortActiveAssistant('superseded', 'programmatic');

    const sessionId = beginAssistantSession();
    rememberSubmittedTurn(text, history);
    const currentTransport = transportRef.current;
    const currentOnSend = onSendRef.current;

    if (currentTransport) {
      if (isChorusDevMode() && currentOnSend && !warnedTransportOnSendRef.current) {
        warnedTransportOnSendRef.current = true;
        console.warn('[Chorus] Both `transport` and `onSend` props were provided. `transport` takes precedence and `onSend` will be ignored. Remove one of the two props to silence this warning.');
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      activeSendPathRef.current = 'transport';
      resetStreamState();
      clearStreamError();
      setTransportBusy(true);
      startTransportStream(sessionId, text, history, controller, 0);
      return;
    }

    if (!currentOnSend) {
      invalidateAssistantSession(sessionId);
      warnMissingResponseHandler();
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    activeSendPathRef.current = 'onSend';
    setInternalSending(true);
    clearStreamError();
    resetStreamState();

    const startedAt = Date.now();
    const sessionHelpers = createSessionHelpers<TMeta>({
      appendAssistantNow,
      appendAssistantReasoningNow,
      appendToolDeltaNow,
      completeActiveSession,
      isAssistantSessionActive,
      minAssistantDelayMsRef,
      systemPromptRef,
      hasStartedAssistantRef,
    }, sessionId, controller.signal, startedAt);

    void (async () => {
      try {
        const res = await currentOnSend(text, history, sessionHelpers.helpers);
        if (!isAssistantSessionActive(sessionId)) return;

        if (res && typeof res === 'object' && !hasStartedAssistantRef.current && !sessionHelpers.hasPendingAssistant()) {
          const wait = Math.max(0, minAssistantDelayMsRef.current - (Date.now() - startedAt));
          if (wait) await new Promise(r => setTimeout(r, wait));
          if (!isAssistantSessionActive(sessionId)) return;

          const returnedMessage = res as Partial<Message<TMeta>>;
          const normalizedMessage = normalizeReturnedMessage(returnedMessage);
          updateSessionMessages(prev => prev.concat(normalizedMessage), { reason: 'assistant' });
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
            observers.safeOnError(error);
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
  }, [abortActiveAssistant, appendAssistantNow, appendAssistantReasoningNow, appendToolDeltaNow, beginAssistantSession, clearStreamError, completeActiveSession, hasStartedAssistantRef, invalidateAssistantSession, isAssistantSessionActive, messagesRef, minAssistantDelayMsRef, observers, onSendRef, rememberSubmittedTurn, removePendingAssistant, resetStreamState, setInternalSending, setTransportBusy, showStreamError, startTransportStream, systemPromptRef, transportRef, updateSessionMessages, warnMissingResponseHandler]);

  const send = React.useCallback((rawText: string, attachments: Attachment[] = []) => {
    if (isBusy()) return false;
    const text = rawText.trim();
    if (!text && !attachments.length) return false;
    if (!transportRef.current && !onSendRef.current) {
      warnMissingResponseHandler();
      return false;
    }

    const next = updateSessionMessages(prev => prev.concat({
      id: createMessageId(),
      role: 'user',
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
    }), { reason: 'send' });
    triggerAssistant(text, next);
    return true;
  }, [isBusy, onSendRef, transportRef, triggerAssistant, updateSessionMessages, warnMissingResponseHandler]);

  const retry = React.useCallback(() => {
    const submitted = lastSubmittedTurnRef.current;
    if (!submitted || isBusy()) return;
    const retryHistory = cloneHistoryForRetry(submitted.history);
    if (streamError) {
      updateSessionMessages(() => retryHistory, { flushPersistence: true, reason: 'retry' });
    }
    triggerAssistant(submitted.text, retryHistory);
  }, [isBusy, streamError, triggerAssistant, updateSessionMessages]);

  const stop = React.useCallback((source: ChorusAbortSource = 'programmatic') => {
    if (!isBusy()) return;
    abortActiveAssistant('stop', source);
  }, [abortActiveAssistant, isBusy]);

  const commitClear = React.useCallback((source: ChorusAbortSource) => {
    if (isBusy()) abortActiveAssistant('clear', source);
    clearStreamError();
    lastSubmittedTurnRef.current = null;
    const reset = resetToInitialMessagesRef.current;
    const next = reset ? seedMessagesRef.current : [];
    updateSessionMessages(() => next, {
      flushPersistence: true,
      removePersistenceIfEmpty: !reset && seedMessagesRef.current.length === 0,
      reason: 'clear',
    });
    onClearRef.current?.(next);
  }, [abortActiveAssistant, clearStreamError, isBusy, onClearRef, resetToInitialMessagesRef, seedMessagesRef, updateSessionMessages]);

  const clear = React.useCallback((source: ChorusAbortSource = 'programmatic') => {
    if (clearConfirmationActiveRef.current) return;

    const confirm = confirmClearConversationRef.current;
    if (!confirm) {
      commitClear(source);
      return;
    }

    const persistenceKeyForContext = persistenceKeyRef.current;
    const context: ChorusClearConversationContext<TMeta> = {
      messages: messagesRef.current.slice(),
      resetToInitialMessages: resetToInitialMessagesRef.current,
      source,
      ...(persistenceKeyForContext ? { persistenceKey: persistenceKeyForContext } : {}),
    };

    let confirmation: boolean | void | Promise<boolean | void>;
    try {
      confirmation = confirm(context);
    } catch (error) {
      warnObserverError('confirmClearConversation', error);
      return;
    }

    if (isPromiseLike<boolean | void>(confirmation)) {
      clearConfirmationActiveRef.current = true;
      setClearConfirmationPending(true);
      Promise.resolve(confirmation)
        .then(confirmed => {
          if (confirmed === false) return;
          commitClear(source);
        })
        .catch(error => warnObserverError('confirmClearConversation', error))
        .finally(() => {
          clearConfirmationActiveRef.current = false;
          setClearConfirmationPending(false);
        });
      return;
    }

    if (confirmation === false) return;
    commitClear(source);
  }, [commitClear, confirmClearConversationRef, messagesRef, persistenceKeyRef, resetToInitialMessagesRef]);

  const handleEdit = React.useCallback((id: string, newText: string) => {
    if (isBusy()) return;
    const currentMessages = messagesRef.current;
    const idx = currentMessages.findIndex(m => m.id === id);
    if (idx === -1) return;
    const currentMessage = currentMessages[idx];
    if (!currentMessage || currentMessage.role !== 'user') return;
    const edited: Message<TMeta> = { ...currentMessage, text: newText };
    const next = updateSessionMessages(prev => [...prev.slice(0, idx), edited], { flushPersistence: true, reason: 'edit' });
    triggerAssistant(newText, next);
  }, [isBusy, messagesRef, triggerAssistant, updateSessionMessages]);

  const handleRegenerate = React.useCallback((id: string) => {
    if (isBusy()) return;
    const currentMessages = messagesRef.current;
    const idx = currentMessages.findIndex(m => m.id === id);
    if (idx === -1) return;
    let userIdx = idx - 1;
    while (userIdx >= 0 && currentMessages[userIdx]?.role !== 'user') userIdx -= 1;
    if (userIdx < 0) return;
    const userMsg = currentMessages[userIdx];
    if (!userMsg || userMsg.role !== 'user') return;
    const next = updateSessionMessages(prev => {
      const history = streamError ? dropTrailingAssistant(prev) : prev;
      return history.slice(0, userIdx + 1);
    }, { flushPersistence: true, reason: 'regenerate' });
    triggerAssistant(userMsg.text, next);
  }, [isBusy, messagesRef, streamError, triggerAssistant, updateSessionMessages]);

  const handleDelete = React.useCallback((id: string) => {
    if (isBusy()) return;
    if (pendingDeleteIdsRef.current.has(id)) return;

    const currentMessages = messagesRef.current;
    const message = currentMessages.find(m => m.id === id);
    if (!message) return;

    const commitDelete = () => {
      updateSessionMessages(prev => prev.filter(m => m.id !== id), { flushPersistence: true, reason: 'delete' });
    };

    let confirmation: boolean | void | Promise<boolean | void>;
    try {
      confirmation = confirmDeleteMessageRef.current?.({ message, messages: currentMessages.slice() });
    } catch (error) {
      warnObserverError('confirmDeleteMessage', error);
      return;
    }

    if (isPromiseLike<boolean | void>(confirmation)) {
      pendingDeleteIdsRef.current.add(id);
      Promise.resolve(confirmation)
        .then(confirmed => {
          if (confirmed === false) return;
          // A send may have started while the confirmation was pending; deleting
          // the active streaming message (or its context) would orphan pending state.
          if (isBusy()) return;
          commitDelete();
        })
        .catch(error => warnObserverError('confirmDeleteMessage', error))
        .finally(() => {
          pendingDeleteIdsRef.current.delete(id);
        });
      return;
    }

    if (confirmation === false) return;
    commitDelete();
  }, [confirmDeleteMessageRef, isBusy, messagesRef, updateSessionMessages]);

  // Reference unused vars to satisfy linters when buffer exposes more than this facade needs.
  void cancelPending;

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
    clearConfirmationPending,
  };
}
