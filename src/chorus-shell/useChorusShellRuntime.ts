import React from 'react';
import { resolveChorusLabels } from '../labels/resolve';
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
import { buildClearControl, buildComposerView, buildRootProps, buildTranscriptProps, type ChorusShellViewProps } from './props';
import { mergeMcpTools } from './mcpTools';
import { useLazyMcpRuntime } from './useLazyMcpRuntime';
import { useToolPolicyStore } from '../hooks/conversations/toolPolicyStore';
import { useLatestRef } from '../hooks/useLatestRef';
import type { ToolApprovalContextValue } from '../components/message-row/approvalContext';

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
    style,
    suggestedPrompts,
    systemPrompt,
    tools,
    toolPolicy,
    toolPolicyScope,
    approvalTimeoutMs,
    transport,
    uploadAttachment,
    value,
    labels,
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

  useChorusPropWarnings<TMeta>({
    messages,
    initialMessages,
    onChange,
    value,
    persistenceKey,
    connector,
    connectorOptions,
    transport,
    onSend,
    onStreamDone,
    sending: sendingProp,
    autoContinueTools,
    maxToolIterations,
    shouldContinueToolLoop,
    tools: mergedTools,
    onToolCall,
    onToolDelta,
    continueOnToolError,
  });

  const session = useAssistantSession<TMeta>({
    messages: msgs,
    updateMessages: updateMsgs,
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
  });

  const shellState = useChorusShellDerivedState<TMeta>({
    palette,
    sending: sendingProp,
    sessionSending: session.sending,
    transport,
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
  const composerActions = useChorusComposerActions({
    draft: composer.draft,
    setDraft: composer.setDraft,
    inputRef: composer.inputRef,
    session,
    writesDisabled: shellState.writesDisabled,
  });

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
      suggestedPrompts,
      defaultHiddenRoles: DEFAULT_CHORUS_HIDDEN_ROLES,
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
      mcpSlashCommands: mcp.slashCommands,
      onMcpSlashCommand: async commandName => {
        const applied = await mcp.applyPrompt(commandName);
        composer.setDraft(applied);
        requestAnimationFrame(() => composer.inputRef.current?.focus({ caret: 'end' }));
      },
      mcpResourceAttachments: mcp.resourceAttachments,
    }),
  };
}
