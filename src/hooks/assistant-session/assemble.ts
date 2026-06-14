import React from 'react';
import { useChorusStream } from '../useChorusStream';
import { useAssistantSessionState } from './sessionState';
import { useResolvedAssistantSessionTransport } from './transportResolver';
import { useSessionBusy } from './sessionBusy';
import { createObserverCallbacks } from './observerCallbacks';
import { useAssistantBuffer } from './assistantBuffer';
import { useToolExecution } from './toolExecution';
import { useSessionCommands } from './sessionCommands';
import { useTransportLifecycle, type DoStream } from './transportLifecycle';
import { useSessionOrchestrator } from './sessionOrchestrator';
import type { useAssistantSessionRefs } from './useAssistantSessionRefs';
import type {
  UseAssistantSessionOptions,
  UseAssistantSessionResult,
} from '../useAssistantSession';

type AssistantSessionRefs<TMeta> = ReturnType<typeof useAssistantSessionRefs<TMeta>>;

export interface AssistantSessionAssemblyOptions<TMeta> {
  options: UseAssistantSessionOptions<TMeta>;
  refs: AssistantSessionRefs<TMeta>;
}

/**
 * Composes the assistant-session sub-hooks (state, observers, buffer, orchestrator,
 * tool execution, transport resolution, stream, busy, transport lifecycle, commands)
 * into the public `UseAssistantSessionResult`. Lifted out of `useAssistantSession.ts`
 * so the facade reads as a thin assembly: destructure options → refs → assembly →
 * return. Mirrors the `useChorusShellRuntime` pattern Chorus.tsx already uses.
 *
 * Pure refactor: cleanup-on-unmount, the `bindLateDeps` ordering between the
 * orchestrator and `useToolExecution` / `useTransportLifecycle`, and dev-warning
 * firing must remain unchanged.
 */
export function useAssistantSessionAssembly<TMeta>({
  options,
  refs,
}: AssistantSessionAssemblyOptions<TMeta>): UseAssistantSessionResult {
  const {
    updateMessages,
    transport,
    connector,
    connectorOptions,
    onChunkRef,
    persistenceKey,
    flushPersistence,
  } = options;
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
    transformRequest: transformRequestRef,
  } = refs;

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
    getNewAssistantMessageDefaults: options.getNewAssistantMessageDefaults,
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
    appendAssistantSourceNow,
    mergeAssistantMetadataNow,
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
    appendAssistantSourceNow,
    mergeAssistantMetadataNow,
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
    policyStoreRef: options.policyStoreRef,
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
    transformRequestRef,
    isAssistantSessionActive,
    invalidateAssistantSession,
    removePendingAssistant,
    setTransportBusy,
    appendAssistantNow,
    appendAssistantReasoningNow,
    appendAssistantSourceNow,
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
