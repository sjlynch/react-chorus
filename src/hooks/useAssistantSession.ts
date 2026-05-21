import React from 'react';
import type { Attachment, Message } from '../types';
import type { Connector, ConnectorWarning } from '../connectors/connectors';
import type { OpenAIConnectorOptions } from '../connectors/openai';
import type { ConnectorName } from '../types';
import { useChorusStream, type Transport } from './useChorusStream';
import { useAssistantSessionRefs } from './assistant-session/useAssistantSessionRefs';
import type { FetchTransportInit } from './assistant-session/transport';
import { DEFAULT_MAX_TOOL_ITERATIONS } from './assistant-session/toolLoop';
import { useAssistantSessionState } from './assistant-session/sessionState';
import { useResolvedAssistantSessionTransport } from './assistant-session/transportResolver';
import { useSessionBusy } from './assistant-session/sessionBusy';
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
  connectorOptions?: OpenAIConnectorOptions;
  onSend?: ChorusOnSend<TMeta>;
  minAssistantDelayMs: number;
  fallbackErrorMessage: string;
  onError?: (error: Error) => void;
  onChunkRef: React.MutableRefObject<((chunk: string, messageId: string) => void) | undefined>;
  onFinish?: ChorusOnFinish<TMeta>;
  onAbort?: ChorusOnAbort<TMeta>;
  onStreamDone?: ChorusOnStreamDone<TMeta>;
  onStreamWarning?: (warning: ConnectorWarning) => void;
  onStreamMetadata?: (metadata: Record<string, unknown>) => void;
  onToolCall?: ChorusOnToolCall<TMeta>;
  onToolDelta?: ChorusOnToolDelta<TMeta>;
  tools?: ChorusToolRegistry<TMeta>;
  autoContinueTools?: boolean;
  maxToolIterations?: number;
  continueOnToolError?: boolean;
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
  connectorOptions,
  onSend,
  minAssistantDelayMs,
  fallbackErrorMessage,
  onError,
  onChunkRef,
  onFinish,
  onAbort,
  onStreamDone,
  onStreamWarning,
  onStreamMetadata,
  onToolCall,
  onToolDelta,
  tools,
  autoContinueTools = false,
  maxToolIterations = DEFAULT_MAX_TOOL_ITERATIONS,
  continueOnToolError = false,
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
    onStreamWarning: onStreamWarningRef,
    onStreamMetadata: onStreamMetadataRef,
    onToolCall: onToolCallRef,
    onToolDelta: onToolDeltaRef,
    tools: toolsRef,
    autoContinueTools: autoContinueToolsRef,
    maxToolIterations: maxToolIterationsRef,
    continueOnToolError: continueOnToolErrorRef,
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
    onStreamWarning,
    onStreamMetadata,
    onToolCall,
    onToolDelta,
    tools,
    autoContinueTools,
    maxToolIterations,
    continueOnToolError,
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
  const {
    pendingDeleteIdsRef,
    clearConfirmationActiveRef,
    clearConfirmationPending,
    setClearConfirmationPending,
    internalSending,
    setInternalSending,
    internalSendingRef,
    transportBusy,
    setTransportBusy,
    transportBusyRef,
    streamError,
    streamRawError,
    clearStreamError,
    showStreamError,
    lastSubmittedTurnRef,
    updateSessionMessages,
    forceRender,
  } = useAssistantSessionState<TMeta>({
    messagesRef,
    fallbackErrorMessageRef,
    updateMessages,
  });

  const observers = React.useMemo(() => createObserverCallbacks<TMeta>({
    onChunkRef,
    onErrorRef,
    onFinishRef,
    onAbortRef,
    onStreamDoneRef,
    onStreamWarningRef,
    onStreamMetadataRef,
    onToolDeltaRef,
    onToolCallRef,
  }), [onAbortRef, onChunkRef, onErrorRef, onFinishRef, onStreamDoneRef, onStreamWarningRef, onStreamMetadataRef, onToolCallRef, onToolDeltaRef]);

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
    persistenceKey,
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
    continueOnToolErrorRef,
    safeOnToolDelta: observers.safeOnToolDelta,
    safeNotifyToolCall: observers.safeNotifyToolCall,
    isAssistantSessionActive,
    forceRender,
  });
  const { appendToolDeltaNow, getToolMessagesByIds, runCompletedToolCalls } = toolExec;

  const resolvedTransport = useResolvedAssistantSessionTransport<TMeta>(transport);
  const { send: doStream, sending: streamSending } = useChorusStream<TMeta>(resolvedTransport, { connector, connectorOptions });
  const { sending, isBusy } = useSessionBusy({
    transport,
    transportRef,
    streamSending,
    transportBusy,
    transportBusyRef,
    internalSending,
    internalSendingRef,
  });

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

  // The orchestrator captures two hook-supplied callbacks at call time via
  // a ref so it can be created before useToolExecution / useTransportLifecycle
  // (which themselves consume orchestrator outputs).
  orchestrator.bindLateDeps({ appendToolDeltaNow, startTransportStream });

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
