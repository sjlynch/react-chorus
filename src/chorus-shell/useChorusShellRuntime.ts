import React from 'react';
import { resolveChorusLabels } from '../labels/resolve';
import { useChorusArtifacts } from '../artifacts/useChorusArtifacts';
import { useChorusPersistence } from '../hooks/useChorusPersistence';
import { useChorusMessages } from '../hooks/useChorusMessages';
import { useAssistantSession } from '../hooks/useAssistantSession';
import { useChorusPropWarnings } from '../hooks/useChorusPropWarnings';
import { useChorusRef } from '../hooks/useChorusRef';
import {
  DEFAULT_CHORUS_HIDDEN_ROLES,
  DEFAULT_MIN_ASSISTANT_DELAY_MS,
  DEFAULT_PERSISTENCE_WRITE_DEBOUNCE_MS,
  type ChorusProps,
  type ChorusRef,
} from '../Chorus.types';
import { resolveBuiltInPersistenceKey, useChorusShellDerivedState } from './derivedState';
import { useChorusComposerActions, useChorusComposerState } from './useComposerActions';
import { buildClearControl, buildComposerView, buildRootProps, buildTranscriptProps, type ChorusArtifactPanelView, type ChorusShellViewProps } from './props';
import { mergeMcpTools } from './mcpTools';
import { useLazyMcpRuntime } from './useLazyMcpRuntime';
import { useToolPolicyStore } from '../hooks/conversations/toolPolicyStore';
import { useLatestRef } from '../hooks/useLatestRef';
import type { ToolApprovalContextValue } from '../components/message-row/approvalContext';
import type { BlockEmit, BlockEmitPayload } from '../blocks/types';
import { resolveToolHandler } from '../tools';
import { createMessageId } from '../hooks/assistant-session/messageUtils';
import { isPositiveFinite, useCostMeter } from './useCostMeter';
import { buildCostFooterRenderer } from './renderCostFooter';
import { useMultiProviderRuntime } from './multiProvider';
import { useConversationMetadataSync } from './useConversationMetadataSync';
import type { ChatInputSlashCommand } from '../components/chat-input/types';

export function useChorusShellRuntime<TMeta = Record<string, unknown>>(
  {
    accept,
    alwaysShowMessageActions = false,
    className,
    clearLabel,
    codeBlockTheme = 'dark',
    connector,
    connectorOptions,
    confirmDeleteMessage,
    confirmClearConversation,
    autoContinueTools,
    maxToolIterations,
    continueOnToolError,
    shouldContinueToolLoop,
    disabled = false,
    disabledReason,
    deserializeMessages,
    emptyState,
    errorMessage,
    headless = false,
    hiddenRoles,
    getMessageFeedback,
    initialMessages,
    markdownProps,
    markdownSanitizer,
    maxAttachmentBytes,
    maxAttachments,
    maxRenderedMessages,
    messages,
    minAssistantDelayMs = DEFAULT_MIN_ASSISTANT_DELAY_MS,
    mcpServers,
    onAttachmentError,
    renderAttachmentError,
    onChange,
    onChunk,
    onClear,
    onCopy,
    onError,
    onFeedback,
    onAbort,
    onFinish,
    onMessagesChange,
    onStreamDone,
    onStreamWarning,
    onStreamMetadata,
    onToolCall,
    onToolDelta,
    onPersistenceError,
    onSend,
    palette,
    persistenceKey,
    persistenceStorage,
    conversationMetadata,
    onConversationMetadataChange,
    placeholder,
    renderError,
    renderMessage,
    readOnly = false,
    resetToInitialMessages = false,
    sending: sendingProp,
    serializeMessages,
    showClearButton = false,
    showJumpToBottomButton,
    showTimestamps = false,
    formatTimestamp,
    showSpeakerAvatars = false,
    style,
    suggestedPrompts,
    systemPrompt,
    transformRequest,
    tools,
    toolPolicy,
    toolPolicyScope,
    approvalTimeoutMs,
    transport,
    uploadAttachment,
    value,
    labels,
    renderReactArtifact,
    blocks,
    toolLoadingComponents,
    showCost = false,
    pricing,
    modelId,
    costEstimator,
    budgetAlert,
    onBudgetExceeded,
    providers,
    defaultProvider,
    ...rest
  }: ChorusProps<TMeta>,
  ref: React.ForwardedRef<ChorusRef<TMeta>>,
): ChorusShellViewProps<TMeta> {
  const resolvedLabels = React.useMemo(() => resolveChorusLabels(labels), [labels]);
  const resolvedClearLabel = clearLabel ?? resolvedLabels.clearConversation;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const fallbackErrorMessage = errorMessage ?? 'Something went wrong. Please try again.';
  const builtInPersistenceKey = resolveBuiltInPersistenceKey<TMeta>(value, persistenceKey);
  const composer = useChorusComposerState<TMeta>({
    persistenceKey: builtInPersistenceKey,
    onClear,
  });
  useConversationMetadataSync({
    persistenceKey: builtInPersistenceKey,
    persistenceStorage,
    conversationMetadata,
    onConversationMetadataChange,
    onPersistenceError,
  });
  const persisted = useChorusPersistence<TMeta>(builtInPersistenceKey, {
    storage: builtInPersistenceKey ? persistenceStorage : null,
    writeDebounceMs: DEFAULT_PERSISTENCE_WRITE_DEBOUNCE_MS,
    onError: builtInPersistenceKey ? onPersistenceError : undefined,
    serializeMessages,
    deserializeMessages,
  });
  const { msgs, messagesRef, updateMsgs, onChunkRef, seedMessages } = useChorusMessages<TMeta>({
    value,
    messages,
    initialMessages,
    onChange,
    onMessagesChange,
    persistenceKey: builtInPersistenceKey,
    persistedMessages: persisted.value,
    persistenceLoaded: persisted.loaded,
    hasPersistedValue: persisted.hasStoredValue,
    canPersist: persisted.canPersist,
    onPersistedChange: persisted.onChange,
    onChunk,
  });
  const mcp = useLazyMcpRuntime<TMeta>(mcpServers);
  const mergedTools = React.useMemo(() => mergeMcpTools<TMeta>(tools, mcp.tools), [mcp.tools, tools]);
  const policyStore = useToolPolicyStore({
    policy: toolPolicy,
    scope: toolPolicyScope,
    storage: persistenceStorage ?? null,
    persistenceKey: builtInPersistenceKey || undefined,
    approvalTimeoutMs,
  });
  const policyStoreRef = useLatestRef(policyStore);

  const multiProvider = useMultiProviderRuntime<TMeta>({
    providers,
    defaultProvider,
    fallbackTransport: transport,
    fallbackConnector: typeof connector === 'string' ? connector : undefined,
    fallbackModelId: modelId,
  });
  // The active provider's transport/connector replace the conversation-level
  // fallbacks for the next turn. Falls through when no providers map is
  // configured so the single-provider path remains untouched.
  const effectiveTransport = multiProvider.effectiveTransport ?? transport;
  const effectiveConnector = providers && multiProvider.effectiveConnector
    ? multiProvider.effectiveConnector
    : connector;
  const effectiveModelId = multiProvider.effectiveModelId ?? modelId;

  useChorusPropWarnings<TMeta>({
    messages,
    initialMessages,
    onChange,
    value,
    persistenceKey,
    connector: effectiveConnector,
    connectorOptions,
    transport: effectiveTransport,
    onSend,
    onStreamDone,
    showCost,
    sending: sendingProp,
    autoContinueTools,
    maxToolIterations,
    shouldContinueToolLoop,
    tools: mergedTools,
    onToolCall,
    onToolDelta,
    continueOnToolError,
  });

  // The cost meter intercepts `onStreamMetadata` to attach connector-emitted
  // usage payloads to the active streaming assistant message. It reads the
  // streaming id by ref because session.streamingMessageId is only known
  // AFTER useAssistantSession runs — and we need to pass the wrapped callback
  // INTO useAssistantSession. The ref keeps the callback identity stable
  // across renders so the session doesn't see a new metadata handler each turn.
  const streamingMessageIdRef = React.useRef<string | null>(null);
  const costMeter = useCostMeter<TMeta>({
    enabled: showCost,
    messages: msgs,
    streamingMessageIdRef,
    pricing,
    defaultModelId: effectiveModelId,
    costEstimator,
    budgetAlert,
    onBudgetExceeded,
    onStreamMetadata,
    updateMessages: updateMsgs,
  });

  const session = useAssistantSession<TMeta>({
    messages: msgs,
    updateMessages: updateMsgs,
    seedMessages,
    transport: effectiveTransport,
    systemPrompt,
    connector: effectiveConnector,
    connectorOptions,
    onSend,
    getNewAssistantMessageDefaults: multiProvider.getAssistantMessageDefaults,
    minAssistantDelayMs,
    fallbackErrorMessage,
    onError,
    onChunkRef,
    onFinish,
    onAbort,
    onStreamDone,
    onStreamWarning,
    onStreamMetadata: costMeter.onStreamMetadata,
    onToolCall,
    onToolDelta,
    tools: mergedTools,
    autoContinueTools,
    maxToolIterations,
    continueOnToolError,
    shouldContinueToolLoop,
    confirmDeleteMessage,
    confirmClearConversation,
    persistenceKey: builtInPersistenceKey || undefined,
    flushPersistence: persisted.flush,
    resetToInitialMessages,
    onClear: composer.handleClearCommit,
    policyStoreRef,
    transformRequest,
  });

  const shellState = useChorusShellDerivedState<TMeta>({
    palette,
    sending: sendingProp,
    sessionSending: session.sending,
    transport: effectiveTransport,
    onSend,
    showJumpToBottomButton,
    headless,
    disabled,
    disabledReason,
    readOnly,
    builtInPersistenceKey,
    persistenceLoaded: persisted.loaded,
    value,
    onChange,
  });
  // Keep the streaming id ref aligned with the live session value so the
  // metadata wrapper above always sees the current target message.
  streamingMessageIdRef.current = session.streamingMessageId;
  const composerActions = useChorusComposerActions({
    draft: composer.draft,
    setDraft: composer.setDraft,
    inputRef: composer.inputRef,
    session,
    writesDisabled: shellState.writesDisabled,
  });

  const artifacts = useChorusArtifacts(msgs);
  const artifactHandle = React.useMemo(() => ({
    openArtifact: artifacts.openArtifact,
    getArtifact: artifacts.getArtifact,
    getMessageVersion: (artifactId: string, messageId: string) => {
      const a = artifacts.getArtifact(artifactId);
      if (!a) return null;
      const v = a.versions.find(version => version.messageId === messageId);
      return v ? v.version : null;
    },
  }), [artifacts]);

  useChorusRef<TMeta>(ref, {
    session,
    resetComposer: composer.resetComposer,
    messagesRef,
    rootRef,
    inputRef: composer.inputRef,
    writesDisabled: shellState.writesDisabled,
    controlledWithoutOnChange: shellState.controlledWithoutOnChange,
    policyStore,
  });

  const approvalContextValue = React.useMemo<ToolApprovalContextValue>(() => ({
    respond: (toolCallId, toolName, decision) => {
      if (decision === 'allow-always') policyStore.setPerToolDecision(toolName, 'allow');
      policyStore.respondToApproval(toolCallId, decision === 'deny' ? 'denied' : 'allowed');
    },
  }), [policyStore]);

  // Generative-UI emit channel: interactive blocks call this to synthesize a
  // user turn (`emit(text)`) or to invoke a registered tool directly without
  // a user-visible message (`emit({ toolCall: { name, input } })`).
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const mergedToolsRef = React.useRef(mergedTools);
  mergedToolsRef.current = mergedTools;
  const updateMsgsRef = React.useRef(updateMsgs);
  updateMsgsRef.current = updateMsgs;
  const messagesRefForEmit = messagesRef;
  const blockEmit = React.useCallback<BlockEmit>((payload) => {
    if (typeof payload === 'string') {
      sessionRef.current.send(payload);
      return;
    }
    const obj = payload as BlockEmitPayload | undefined;
    if (!obj) return;
    if (typeof obj.text === 'string') {
      sessionRef.current.send(obj.text);
      return;
    }
    if (obj.toolCall && typeof obj.toolCall.name === 'string') {
      const { name, input } = obj.toolCall;
      const messageId = createMessageId();
      updateMsgsRef.current(prev => prev.concat({
        id: messageId,
        role: 'tool',
        text: '',
        toolCall: { id: messageId, name, input },
      }), { reason: 'assistant' });
      const handler = resolveToolHandler<TMeta>(mergedToolsRef.current, name);
      if (handler) {
        const controller = new AbortController();
        const toolMessage = { id: messageId, role: 'tool' as const, text: '', toolCall: { id: messageId, name, input } };
        const context = {
          id: messageId,
          name,
          input,
          message: toolMessage,
          messages: messagesRefForEmit.current,
          signal: controller.signal,
        };
        Promise.resolve()
          .then(() => handler(input, context as Parameters<typeof handler>[1]))
          .then(output => {
            updateMsgsRef.current(prev => prev.map(m => m.id === messageId && m.role === 'tool'
              ? { ...m, toolCall: { ...m.toolCall, output } }
              : m), { reason: 'assistant' });
          })
          .catch(() => {
            // Errors from emit-triggered tools are surfaced as the tool row's
            // output payload, mirroring the standard tool-error recording shape.
            updateMsgsRef.current(prev => prev.map(m => m.id === messageId && m.role === 'tool'
              ? { ...m, toolCall: { ...m.toolCall, output: { error: 'tool failed' } } }
              : m), { reason: 'assistant' });
          });
      }
    }
  }, [messagesRefForEmit]);

  // Per-bubble cost chip renderer. The cost map already filters to assistant
  // messages with usage; the streaming bubble (which has no `usage` yet)
  // falls back to a heuristic `~N tok` chip so the meter has something to
  // show before the terminal `done` frame.
  const renderMessageFooter = React.useMemo(() => {
    if (!showCost) return undefined;
    return buildCostFooterRenderer<TMeta>({
      cost: costMeter.cost,
      streamingMessageId: session.streamingMessageId,
      defaultModelId: modelId,
    });
  }, [showCost, costMeter.cost, session.streamingMessageId, modelId]);

  return {
    rootRef,
    rootProps: buildRootProps({
      ...rest,
      className,
      style,
      disabled,
      readOnly,
      alwaysShowMessageActions,
      writesDisabled: shellState.writesDisabled,
      paletteVars: shellState.paletteVars,
    }),
    transcriptProps: buildTranscriptProps<TMeta>({
      messages: msgs,
      shellState,
      session,
      composerActions,
      codeBlockTheme,
      emptyState,
      getMessageFeedback,
      headless,
      hiddenRoles,
      labels,
      markdownProps,
      markdownSanitizer,
      maxRenderedMessages,
      onCopy,
      onFeedback,
      renderError,
      renderMessage,
      showTimestamps,
      formatTimestamp,
      showSpeakerAvatars,
      suggestedPrompts,
      defaultHiddenRoles: DEFAULT_CHORUS_HIDDEN_ROLES,
      renderMessageFooter,
    }),
    clearControl: buildClearControl({
      showClearButton,
      clearLabel: resolvedClearLabel,
      handleClear: composerActions.handleClear,
      writesDisabled: shellState.writesDisabled,
      clearConfirmationPending: session.clearConfirmationPending,
      sending: session.sending,
      messageCount: msgs.length,
    }),
    mcpStatus: {
      servers: mcp.servers,
      reconnect: mcp.reconnect,
    },
    approvalContextValue,
    blockRuntime: {
      blocks,
      toolLoadingComponents,
      emit: blockEmit,
      sending: shellState.visualSending,
    },
    costView: showCost ? { cost: costMeter.cost, budget: isPositiveFinite(budgetAlert) ? budgetAlert : undefined } : undefined,
    composer: buildComposerView<TMeta>({
      composer,
      composerActions,
      shellState,
      resolvedLabels,
      accept,
      maxAttachmentBytes,
      maxAttachments,
      onAttachmentError,
      placeholder,
      readOnly,
      renderAttachmentError,
      uploadAttachment,
      mcpSlashCommands: ([] as ChatInputSlashCommand[]).concat(multiProvider.slashCommands, mcp.slashCommands),
      onMcpSlashCommand: async commandName => {
        if (multiProvider.handleSlashCommand(commandName)) {
          // `/model:<id>` switches the active provider without sending; clear
          // the slash text so the composer doesn't try to send the literal
          // command as a user turn.
          composer.setDraft('');
          requestAnimationFrame(() => composer.inputRef.current?.focus({ caret: 'end' }));
          return;
        }
        const applied = await mcp.applyPrompt(commandName);
        composer.setDraft(applied);
        requestAnimationFrame(() => composer.inputRef.current?.focus({ caret: 'end' }));
      },
      mcpResourceAttachments: mcp.resourceAttachments,
      modelPicker: multiProvider.modelPicker,
    }),
    artifactPanel: {
      artifacts: artifacts.artifacts,
      activeId: artifacts.activeId,
      activeVersion: artifacts.activeVersion,
      open: artifacts.open,
      onClose: artifacts.closeArtifact,
      onChangeVersion: artifacts.setActiveVersion,
      codeTheme: codeBlockTheme,
      markdownSanitizer,
      renderReactArtifact,
      handle: artifactHandle,
    } satisfies ChorusArtifactPanelView,
  };
}
