import React from 'react';
import './Chorus.css';
import { ChatWindow } from './components/ChatWindow';
import { ChatInput } from './components/ChatInput';
import type { ChatInputHandle } from './components/ChatInput';
import { styleVarsFromPalette } from './utils/paletteVars';
import type { Attachment, Message } from './types';
import { resolveChorusLabels } from './labels/resolve';
import { useChorusPersistence } from './hooks/useChorusPersistence';
import { useChorusMessages } from './hooks/useChorusMessages';
import { useAssistantSession } from './hooks/useAssistantSession';
import { useChorusPropWarnings } from './hooks/useChorusPropWarnings';
import { useChorusRef } from './hooks/useChorusRef';
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
  const inputRef = React.useRef<ChatInputHandle>(null);
  const [draft, setDraft] = React.useState('');
  const [composerResetKey, setComposerResetKey] = React.useState(0);
  const fallbackErrorMessage = errorMessage ?? 'Something went wrong. Please try again.';

  const builtInPersistenceKey = value === undefined ? persistenceKey ?? '' : '';
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
  });

  const resetComposer = React.useCallback(() => {
    setDraft('');
    setComposerResetKey(key => key + 1);
  }, []);

  const onClearRef = React.useRef(onClear);
  React.useEffect(() => {
    onClearRef.current = onClear;
  }, [onClear]);

  const handleClearCommit = React.useCallback((next: Message<TMeta>[]) => {
    resetComposer();
    onClearRef.current?.(next);
  }, [resetComposer]);

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
    onClear: handleClearCommit,
  });

  const visualSending = sendingProp ?? session.sending;
  const paletteVars = React.useMemo(() => styleVarsFromPalette(palette), [palette]);
  const canAssistantRespond = Boolean(transport || onSend);
  const resolvedShowJumpToBottomButton = showJumpToBottomButton ?? !headless;
  const persistenceLoading = Boolean(builtInPersistenceKey) && !persisted.loaded;
  const canRenderEmptyAffordance = value !== undefined || !builtInPersistenceKey || persisted.loaded;
  const writesDisabled = disabled || readOnly || persistenceLoading;
  const composerDisabled = disabled || persistenceLoading;
  const resolvedDisabledReason = persistenceLoading ? disabledReason ?? 'Loading saved conversation…' : disabledReason;

  const previousPersistenceKeyRef = React.useRef(builtInPersistenceKey);
  React.useEffect(() => {
    if (previousPersistenceKeyRef.current === builtInPersistenceKey) return;
    previousPersistenceKeyRef.current = builtInPersistenceKey;
    resetComposer();
  }, [builtInPersistenceKey, resetComposer]);

  const handleInputSend = React.useCallback((attachments: Attachment[] = []) => {
    if (writesDisabled) return false;
    const accepted = session.send(draft, attachments);
    if (accepted) setDraft('');
    return accepted;
  }, [draft, session, writesDisabled]);

  const handleStop = React.useCallback(() => {
    session.stop('user');
  }, [session]);

  const handleClear = React.useCallback(() => {
    if (writesDisabled || session.clearConfirmationPending) return;
    session.clear('user');
  }, [session, writesDisabled]);

  const handleSuggestedPrompt = React.useCallback((prompt: string) => {
    if (writesDisabled) return;
    setDraft(prompt);

    const focusComposer = () => {
      inputRef.current?.focus({ caret: 'end' });
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusComposer);
    } else {
      focusComposer();
    }
  }, [writesDisabled]);

  const controlledWithoutOnChange = value !== undefined && !onChange;

  useChorusRef<TMeta>(ref, {
    session,
    setDraft,
    messagesRef,
    rootRef,
    inputRef,
    writesDisabled,
    controlledWithoutOnChange,
  });

  return (
    <div
      {...rest}
      ref={rootRef}
      className={["chorus", disabled && "chorus--disabled", readOnly && "chorus--readonly", alwaysShowMessageActions && "chorus--always-show-actions", className].filter(Boolean).join(" ")}
      style={{ ...paletteVars, ...style }}
      aria-disabled={writesDisabled ? true : rest['aria-disabled']}
    >
      <ChatWindow<TMeta>
        messages={msgs}
        typing={canAssistantRespond && visualSending && !session.hasStartedAssistant}
        codeTheme={codeBlockTheme}
        emptyState={canRenderEmptyAffordance ? emptyState : undefined}
        error={session.streamError}
        headless={headless}
        hiddenRoles={hiddenRoles ?? DEFAULT_CHORUS_HIDDEN_ROLES}
        markdownProps={markdownProps}
        markdownSanitizer={markdownSanitizer}
        maxRenderedMessages={maxRenderedMessages}
        getMessageFeedback={getMessageFeedback}
        onCopy={onCopy}
        onDelete={writesDisabled || session.sending ? undefined : session.handleDelete}
        onDismissError={session.dismissError}
        onEdit={!writesDisabled && canAssistantRespond ? session.handleEdit : undefined}
        onFeedback={writesDisabled ? undefined : onFeedback}
        onRegenerate={!writesDisabled && canAssistantRespond ? session.handleRegenerate : undefined}
        onRetry={writesDisabled ? undefined : session.retry}
        onSuggestedPrompt={writesDisabled ? undefined : handleSuggestedPrompt}
        rawError={session.streamRawError}
        renderError={renderError}
        renderMessage={renderMessage}
        showJumpToBottomButton={resolvedShowJumpToBottomButton}
        showTimestamps={showTimestamps}
        formatTimestamp={formatTimestamp}
        streamingMessageId={session.streamingMessageId}
        suggestedPrompts={canRenderEmptyAffordance ? suggestedPrompts : undefined}
        suggestedPromptsDisabled={writesDisabled}
        suggestedPromptsDisabledReason={resolvedDisabledReason}
        labels={labels}
      />
      {showClearButton && (
        <div className="chorus-clear-row">
          <button type="button" className="chorus-clear-btn" onClick={handleClear} disabled={writesDisabled || session.clearConfirmationPending || (!session.sending && msgs.length === 0)}>
            {resolvedClearLabel}
          </button>
        </div>
      )}
      <ChatInput
        ref={inputRef}
        value={draft}
        onChange={setDraft}
        onSend={handleInputSend}
        onStop={handleStop}
        sending={visualSending}
        disabled={composerDisabled}
        readOnly={readOnly}
        disabledReason={resolvedDisabledReason}
        resetKey={composerResetKey}
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
