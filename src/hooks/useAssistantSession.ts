import React from 'react';
import type { Attachment, Message } from '../types';
import type { Connector } from '../connectors/connectors';
import type { ConnectorName } from '../types';
import { useChorusStream, type Transport } from './useChorusStream';
import { useLatestRef } from './useLatestRef';
import { useMirroredState } from './useMirroredState';
import { useAssistantSessionRefs } from './assistant-session/useAssistantSessionRefs';
import { createDefaultFetchSSETransport, type FetchTransportInit } from './assistant-session/transport';
import { DEFAULT_MAX_TOOL_ITERATIONS } from './assistant-session/toolLoop';
import { warnInDev } from '../utils/warnings';
import { createObserverCallbacks } from './assistant-session/observerCallbacks';
import { useAssistantBuffer } from './assistant-session/assistantBuffer';
import { useToolExecution } from './assistant-session/toolExecution';
import { useSessionCommands } from './assistant-session/sessionCommands';
import { useTransportLifecycle, type DoStream } from './assistant-session/transportLifecycle';
import { useSessionOrchestrator } from './assistant-session/sessionOrchestrator';
import type { ChorusToolRegistry } from '../tools';
import type {
  ChorusAbortSource,
  ChorusConfirmClearConversation,
  ChorusConfirmDeleteMessage,
  ChorusOnAbort,
  ChorusOnFinish,
  ChorusOnSend,
  ChorusOnStreamDone,
  ChorusOnToolCall,
  ChorusOnToolDelta,
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

  const orchestrator = useSessionOrchestrator<TMeta>({
    messagesRef,
    transportRef,
    onSendRef,
    minAssistantDelayMsRef,
    systemPromptRef,
    hasStartedAssistantRef,
    pendingAssistantIdRef,
    pendingToolMessageIdsRef,
    lastSubmittedTurnRef,
    updateSessionMessages,
    setInternalSending,
    setTransportBusy,
    forceRender,
    clearStreamError,
    showStreamError,
    appendAssistantNow,
    appendAssistantReasoningNow,
    finalizeAssistantNow,
    resetPendingAssistantState,
    resetStreamState,
    observers,
  });
  const {
    isAssistantSessionActive,
    invalidateAssistantSession,
    removePendingAssistant,
    abortActiveAssistant,
    triggerAssistant,
    warnMissingResponseHandler,
  } = orchestrator;

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

  const resolvedTransport = React.useMemo((): Transport<TMeta> => {
    // Case 1: transport genuinely absent — keep the silent empty-200 fallback.
    // This is the ONLY case for which that stub should remain reachable; an
    // absent transport means the caller is driving output some other way
    // (`onSend`, or not expecting assistant turns at all).
    if (transport == null) {
      return () => Promise.resolve(new Response(null, { status: 200 }));
    }

    // A custom Transport function is opaque to us; resolve it as-is.
    if (typeof transport === 'function') return transport;

    // String shorthand or `{ url }` object: require a usable, non-whitespace
    // URL before resolving. `transport.url` is typed `string`, but a JS caller
    // (unset env var, typo'd key, build-time placeholder) can still land here
    // with `undefined`/`''`, so the runtime checks below are load-bearing.
    const url = typeof transport === 'string' ? transport : transport.url;
    if (typeof url === 'string' && url.trim() !== '') {
      // Case 2: valid config — resolve normally.
      return createDefaultFetchSSETransport<TMeta>(transport);
    }

    // Case 3: transport is present but misconfigured — a bare empty/whitespace
    // string, or a non-null object lacking a usable string `url`. Do NOT fall
    // through to the empty-200 stub: that ends the turn with a blank assistant
    // message and no error. Warn in dev, and resolve to a transport that
    // rejects so the existing stream-error UI surfaces the misconfiguration.
    warnInDev(
      '[Chorus] transport URL is empty/missing; assistant responses are disabled. '
        + 'Did you forget to set an env var or substitute a build-time placeholder?',
    );
    return () => Promise.reject(new Error(
      '[Chorus] transport is misconfigured: no usable URL was provided. Pass a '
        + 'non-empty URL string, or a transport object with a non-empty string `url`.',
    ));
  }, [transport]);

  const { send: doStream, abort: streamAbort, sending: streamSending } = useChorusStream<TMeta>(resolvedTransport, { connector });
  const streamSendingRef = useLatestRef(streamSending);
  const sending = transport ? (streamSending || transportBusy) : internalSending;

  const isBusy = React.useCallback(() => (
    transportRef.current
      ? streamSendingRef.current || transportBusyRef.current
      : internalSendingRef.current
  ), [internalSendingRef, streamSendingRef, transportBusyRef, transportRef]);

  const transportLifecycle = useTransportLifecycle<TMeta>({
    controllerRef: orchestrator.controllerRef,
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

  // The orchestrator captures three hook-supplied callbacks at call time via
  // a ref so it can be created before useToolExecution / useChorusStream /
  // useTransportLifecycle (which themselves consume orchestrator outputs).
  orchestrator.bindLateDeps({ appendToolDeltaNow, streamAbort, startTransportStream });

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
