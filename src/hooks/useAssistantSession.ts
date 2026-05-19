import React from 'react';
import type { Attachment, Message } from '../types';
import type { Connector } from '../connectors/connectors';
import type { ConnectorName } from '../types';
import { useChorusStream, type Transport } from './useChorusStream';
import { useLatestRef } from './useLatestRef';
import { useMirroredState } from './useMirroredState';
import { useAssistantSessionRefs } from './assistant-session/useAssistantSessionRefs';
import { isChorusDevMode } from '../utils/devMode';
import { createDefaultFetchSSETransport, type FetchTransportInit } from './assistant-session/transport';
import { cloneHistoryForRetry, findLastUserMessage } from './assistant-session/messageUtils';
import { DEFAULT_MAX_TOOL_ITERATIONS } from './assistant-session/toolLoop';
import { createObserverCallbacks } from './assistant-session/observerCallbacks';
import { useAssistantBuffer } from './assistant-session/assistantBuffer';
import { useToolExecution } from './assistant-session/toolExecution';
import { startOnSendLifecycle } from './assistant-session/onSendLifecycle';
import { useSessionCommands } from './assistant-session/sessionCommands';
import { useTransportLifecycle, type DoStream } from './assistant-session/transportLifecycle';
import type { ChorusToolRegistry } from '../tools';
import type {
  ChorusAbortReason,
  ChorusAbortSource,
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
  const {
    messages: messagesRef,
    transport: transportRef,
    onSend: onSendRef,
    onError: onErrorRef,
    onFinish: onFinishRef,
    onAbort: onAbortRef,
    onStreamDone: onStreamDoneRef,
    onToolCall: onToolCallRef,
    onToolDelta: onToolDeltaRef,
    tools: toolsRef,
    autoContinueTools: autoContinueToolsRef,
    maxToolIterations: maxToolIterationsRef,
    shouldContinueToolLoop: shouldContinueToolLoopRef,
    confirmDeleteMessage: confirmDeleteMessageRef,
    confirmClearConversation: confirmClearConversationRef,
    persistenceKey: persistenceKeyRef,
    resetToInitialMessages: resetToInitialMessagesRef,
    onClear: onClearRef,
    fallbackErrorMessage: fallbackErrorMessageRef,
    systemPrompt: systemPromptRef,
    minAssistantDelayMs: minAssistantDelayMsRef,
    seedMessages: seedMessagesRef,
  } = useAssistantSessionRefs<TMeta>({
    messages,
    transport,
    onSend,
    onError,
    onFinish,
    onAbort,
    onStreamDone,
    onToolCall,
    onToolDelta,
    tools,
    autoContinueTools,
    maxToolIterations,
    shouldContinueToolLoop,
    confirmDeleteMessage,
    confirmClearConversation,
    persistenceKey,
    resetToInitialMessages,
    onClear,
    fallbackErrorMessage,
    systemPrompt,
    minAssistantDelayMs,
    seedMessages,
  });
  const pendingDeleteIdsRef = React.useRef(new Set<string>());
  const clearConfirmationActiveRef = React.useRef(false);

  const [clearConfirmationPending, setClearConfirmationPending] = React.useState(false);
  const [internalSending, setInternalSending, internalSendingRef] = useMirroredState(false);
  const [transportBusy, setTransportBusy, transportBusyRef] = useMirroredState(false);
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

  const abortActiveAssistant = React.useCallback((reason: ChorusAbortReason, source: ChorusAbortSource) => {
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

    startOnSendLifecycle<TMeta>({
      controllerRef,
      activeSendPathRef,
      minAssistantDelayMsRef,
      systemPromptRef,
      hasStartedAssistantRef,
      setInternalSending,
      clearStreamError,
      resetStreamState,
      appendAssistantNow,
      appendAssistantReasoningNow,
      appendToolDeltaNow,
      completeActiveSession,
      isAssistantSessionActive,
      invalidateAssistantSession,
      removePendingAssistant,
      updateSessionMessages,
      observers,
      showStreamError,
      sessionId,
      text,
      history,
      onSend: currentOnSend,
    });
  }, [abortActiveAssistant, appendAssistantNow, appendAssistantReasoningNow, appendToolDeltaNow, beginAssistantSession, clearStreamError, completeActiveSession, hasStartedAssistantRef, invalidateAssistantSession, isAssistantSessionActive, messagesRef, minAssistantDelayMsRef, observers, onSendRef, rememberSubmittedTurn, removePendingAssistant, resetStreamState, setInternalSending, setTransportBusy, showStreamError, startTransportStream, systemPromptRef, transportRef, updateSessionMessages, warnMissingResponseHandler]);

  const { send, retry, stop, clear, handleEdit, handleRegenerate, handleDelete } = useSessionCommands<TMeta>({
    messagesRef,
    transportRef,
    onSendRef,
    lastSubmittedTurnRef,
    pendingDeleteIdsRef,
    clearConfirmationActiveRef,
    confirmDeleteMessageRef,
    confirmClearConversationRef,
    persistenceKeyRef,
    resetToInitialMessagesRef,
    seedMessagesRef,
    onClearRef,
    streamError,
    isBusy,
    abortActiveAssistant,
    clearStreamError,
    triggerAssistant,
    updateSessionMessages,
    warnMissingResponseHandler,
    setClearConfirmationPending,
  });

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
