import React from 'react';
import './Chorus.css';
import { ChatWindow } from './components/ChatWindow';
import { ChatInput } from './components/ChatInput';
import { resolveChorusLabels } from './labels/resolve';
import { useChorusPersistence } from './hooks/useChorusPersistence';
import { useChorusMessages } from './hooks/useChorusMessages';
import { useAssistantSession } from './hooks/useAssistantSession';
import { useChorusPropWarnings } from './hooks/useChorusPropWarnings';
import { useChorusRef } from './hooks/useChorusRef';
import { useChorusComposerActions, useChorusComposerState } from './chorus-shell/useComposerActions';
import { resolveBuiltInPersistenceKey, useChorusShellDerivedState } from './chorus-shell/derivedState';
import { DEFAULT_CHORUS_HIDDEN_ROLES, DEFAULT_MIN_ASSISTANT_DELAY_MS, DEFAULT_PERSISTENCE_WRITE_DEBOUNCE_MS, type ChorusProps, type ChorusRef } from './Chorus.types';

export type { Transport, FetchTransportInit, Connector, RenderAttachmentErrorContext, ChorusAbortContext, ChorusAbortReason, ChorusAbortSource, ChorusClearConversationContext, ChorusConfirmClearConversation, ChorusConfirmDeleteMessage, ChorusDeleteMessageContext, ChorusFinishContext, ChorusMessagesChangeContext, ChorusOnAbort, ChorusOnFinish, ChorusOnSend, ChorusOnStreamDone, ChorusOnToolCall, ChorusOnToolDelta, ChorusProps, ChorusRef, ChorusSendHelpers, ChorusSendPath, ChorusShouldContinueToolLoop, ChorusStreamDoneContext, ChorusStreamDoneReason, ChorusToolCallContext, ChorusToolDeltaContext, ChorusToolLoopContext, ChorusToolRegistry } from './Chorus.types';

function ChorusInner<TMeta = Record<string, unknown>>({
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
  ...rest
}: ChorusProps<TMeta>, ref: React.ForwardedRef<ChorusRef<TMeta>>) {
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
    sending: sendingProp,
    autoContinueTools,
    maxToolIterations,
    shouldContinueToolLoop,
    tools,
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
    onToolCall,
    onToolDelta,
    tools,
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

  return (
    <div
      {...rest}
      ref={rootRef}
      className={["chorus", disabled && "chorus--disabled", readOnly && "chorus--readonly", alwaysShowMessageActions && "chorus--always-show-actions", className].filter(Boolean).join(" ")}
      style={{ ...shellState.paletteVars, ...style }}
      aria-disabled={shellState.writesDisabled ? true : rest['aria-disabled']}
    >
      <ChatWindow<TMeta>
        messages={msgs}
        typing={shellState.canAssistantRespond && shellState.visualSending && !session.hasStartedAssistant}
        codeTheme={codeBlockTheme}
        emptyState={shellState.canRenderEmptyAffordance ? emptyState : undefined}
        error={session.streamError}
        headless={headless}
        hiddenRoles={hiddenRoles ?? DEFAULT_CHORUS_HIDDEN_ROLES}
        markdownProps={markdownProps}
        markdownSanitizer={markdownSanitizer}
        maxRenderedMessages={maxRenderedMessages}
        getMessageFeedback={getMessageFeedback}
        onCopy={onCopy}
        onDelete={shellState.canDeleteMessages ? session.handleDelete : undefined}
        onDismissError={session.dismissError}
        onEdit={shellState.canRunAssistantActions ? session.handleEdit : undefined}
        onFeedback={shellState.canSubmitFeedback ? onFeedback : undefined}
        onRegenerate={shellState.canRunAssistantActions ? session.handleRegenerate : undefined}
        onRetry={shellState.canRetry ? session.retry : undefined}
        onSuggestedPrompt={shellState.canSuggestPrompt ? composerActions.handleSuggestedPrompt : undefined}
        rawError={session.streamRawError}
        renderError={renderError}
        renderMessage={renderMessage}
        showJumpToBottomButton={shellState.resolvedShowJumpToBottomButton}
        showTimestamps={showTimestamps}
        formatTimestamp={formatTimestamp}
        streamingMessageId={session.streamingMessageId}
        suggestedPrompts={shellState.canRenderEmptyAffordance ? suggestedPrompts : undefined}
        suggestedPromptsDisabled={shellState.writesDisabled}
        suggestedPromptsDisabledReason={shellState.resolvedDisabledReason}
        labels={labels}
      />
      {showClearButton && (
        <div className="chorus-clear-row">
          <button type="button" className="chorus-clear-btn" onClick={composerActions.handleClear} disabled={shellState.writesDisabled || session.clearConfirmationPending || (!session.sending && msgs.length === 0)}>
            {resolvedClearLabel}
          </button>
        </div>
      )}
      <ChatInput
        ref={composer.inputRef}
        value={composer.draft}
        onChange={composer.setDraft}
        onSend={composerActions.handleInputSend}
        onStop={composerActions.handleStop}
        sending={shellState.visualSending}
        disabled={shellState.composerDisabled}
        readOnly={readOnly}
        disabledReason={shellState.resolvedDisabledReason}
        resetKey={composer.composerResetKey}
        placeholder={placeholder}
        labels={resolvedLabels.composer}
        attachmentLabels={resolvedLabels.attachments}
        accept={accept}
        maxAttachmentBytes={maxAttachmentBytes}
        maxAttachments={maxAttachments}
        onAttachmentError={onAttachmentError}
        renderAttachmentError={renderAttachmentError}
        uploadAttachment={uploadAttachment}
      />
    </div>
  );
}

export const Chorus = React.forwardRef(ChorusInner) as <TMeta = Record<string, unknown>>(
  props: ChorusProps<TMeta> & React.RefAttributes<ChorusRef<TMeta>>,
) => React.ReactElement | null;

(Chorus as React.NamedExoticComponent).displayName = 'Chorus';

export default Chorus;
