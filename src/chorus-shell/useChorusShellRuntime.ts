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
import type { BlockEmit, BlockEmitPayload } from '../blocks/types';
import { resolveToolHandler } from '../tools';
import { createMessageId } from '../hooks/assistant-session/messageUtils';

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
    transport,
    uploadAttachment,
    value,
    labels,
    blocks,
    toolLoadingComponents,
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
  });

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
    blockRuntime: {
      blocks,
      toolLoadingComponents,
      emit: blockEmit,
      sending: shellState.visualSending,
    },
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
