import React from 'react';
import type { Message } from '../types';
import { resolveChorusLabels } from '../labels/resolve';
import { useCanWriteTextToClipboard, writeTextToClipboard } from '../utils/messageCopy';
import { visibleActivityKey } from './chat-window/activityKey';
import { useMessageFeedbackState } from './chat-window/feedback';
import { MessageList } from './chat-window/MessageList';
import { createHiddenRoleSet, filterVisibleMessages, getEffectiveHiddenRoles, normalizeMaxRenderedMessages, windowVisibleMessages } from './chat-window/messageWindowing';
import { ErrorRow, JumpToBottomButton, TranscriptEmptyState, TypingRow } from './chat-window/TranscriptStatusRows';
import type { ChatWindowProps } from './chat-window/types';
import { useAutoScroll } from './chat-window/useAutoScroll';
import { styleVarsFromPalette } from '../utils/paletteVars';
import type { MessageCopyResult } from './MessageRow';

export { stringActivityKey } from './chat-window/activityKey';
export { MessageBubble } from './MessageRow';
export type { ChatWindowProps, RenderErrorContext, RenderMessageContext, RenderMessageRootProps } from './chat-window/types';
export type { GetMessageFeedback, MessageBubbleProps, MessageBubbleSlots, MessageCopyResult, MessageFeedback, MessageMarkdownProps, MessageRenderActions, MessageTimestampFormatter } from './MessageRow';

let didWarnShowSystemMessages = false;

// Keep this local so hook-only chunks do not share a dev-mode module with ChatWindow.
function isChorusDevMode() {
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

function ChatWindowInner<TMeta = Record<string, unknown>>({
  messages,
  typing,
  codeTheme = 'dark',
  emptyState,
  error,
  headless = false,
  hiddenRoles,
  markdownProps,
  markdownSanitizer,
  maxRenderedMessages,
  getMessageFeedback,
  onCopy,
  onDelete,
  onDismissError,
  onEdit,
  onFeedback,
  onRegenerate,
  onRetry,
  onSuggestedPrompt,
  rawError = null,
  renderError,
  renderMessage,
  showJumpToBottomButton = !headless,
  showSystemMessages,
  showTimestamps = false,
  formatTimestamp,
  streamingMessageId,
  suggestedPrompts,
  suggestedPromptsDisabled = false,
  suggestedPromptsDisabledReason,
  labels,
  palette,
  className,
  style,
  ...rest
}: ChatWindowProps<TMeta>, ref: React.ForwardedRef<HTMLDivElement>) {
  const resolvedLabels = React.useMemo(() => resolveChorusLabels(labels), [labels]);
  const paletteVars = React.useMemo(() => styleVarsFromPalette(palette), [palette]);
  React.useEffect(() => {
    if (!isChorusDevMode() || showSystemMessages === undefined || didWarnShowSystemMessages) return;
    console.warn('[Chorus] `showSystemMessages` is deprecated. Use `hiddenRoles` instead (for example hiddenRoles={[\'system\']} to show tool messages while hiding system prompts).');
    didWarnShowSystemMessages = true;
  }, [showSystemMessages]);

  const effectiveHiddenRoles = getEffectiveHiddenRoles(hiddenRoles, showSystemMessages);
  const hiddenRoleSet = React.useMemo(() => createHiddenRoleSet(effectiveHiddenRoles), [effectiveHiddenRoles]);
  const visible = React.useMemo(() => filterVisibleMessages(messages, hiddenRoleSet), [messages, hiddenRoleSet]);
  const normalizedMaxRenderedMessages = React.useMemo(() => normalizeMaxRenderedMessages(maxRenderedMessages), [maxRenderedMessages]);
  const renderedVisible = React.useMemo(() => windowVisibleMessages(visible, normalizedMaxRenderedMessages), [normalizedMaxRenderedMessages, visible]);
  // Defer the navigator.clipboard feature-detect to a mount effect so the
  // server-rendered tree and the initial client render agree (no hydration
  // mismatch from clipboard-only browser APIs being absent on the server).
  const clipboardWritable = useCanWriteTextToClipboard();
  const copyAvailable = Boolean(onCopy) || clipboardWritable;
  const copyMessage = React.useCallback((message: Message<TMeta>): MessageCopyResult => {
    if (onCopy) return onCopy(message);

    return writeTextToClipboard(message.text ?? '');
  }, [onCopy]);
  const { getSelectedFeedback, handleMessageFeedback } = useMessageFeedbackState({ messages, getMessageFeedback, onFeedback });
  // Read-only feedback: historical reactions are available (getMessageFeedback)
  // but there is no handler to record new ones, so render the thumbs inert.
  const feedbackReadOnly = Boolean(getMessageFeedback) && !onFeedback;
  const activityKey = React.useMemo(() => visibleActivityKey(visible, typing, streamingMessageId, error), [visible, typing, streamingMessageId, error]);
  const { windowRef, hasUnreadActivity, isAutoScrollPaused, scrollToBottom } = useAutoScroll<HTMLDivElement>(activityKey, ref);

  const hasEmptyTranscript = visible.length === 0 && !typing;
  const shouldRenderJumpToBottom = showJumpToBottomButton && isAutoScrollPaused && hasUnreadActivity;

  return (
    <div
      {...rest}
      className={["chorus-window", headless ? "chorus-window--headless" : undefined, className].filter(Boolean).join(" ")}
      style={{ ...paletteVars, ...style }}
      ref={windowRef}
      role="log"
      aria-live="polite"
      aria-atomic="false"
      aria-label={resolvedLabels.transcript.ariaLabel}
    >
      <MessageList
        messages={renderedVisible}
        codeTheme={codeTheme}
        headless={headless}
        markdownProps={markdownProps}
        markdownSanitizer={markdownSanitizer}
        streamingMessageId={streamingMessageId}
        renderMessage={renderMessage}
        showTimestamps={showTimestamps}
        formatTimestamp={formatTimestamp}
        resolvedLabels={resolvedLabels}
        copyAvailable={copyAvailable}
        copyMessage={copyMessage}
        feedbackEnabled={Boolean(onFeedback)}
        feedbackReadOnly={feedbackReadOnly}
        getSelectedFeedback={getSelectedFeedback}
        onMessageFeedback={handleMessageFeedback}
        onDelete={onDelete}
        onEdit={onEdit}
        onRegenerate={onRegenerate}
      />

      <TranscriptEmptyState
        hasEmptyTranscript={hasEmptyTranscript}
        emptyState={emptyState}
        suggestedPrompts={suggestedPrompts}
        onSuggestedPrompt={onSuggestedPrompt}
        suggestedPromptsDisabled={suggestedPromptsDisabled}
        suggestedPromptsDisabledReason={suggestedPromptsDisabledReason}
        labels={resolvedLabels.transcript}
      />
      <TypingRow typing={typing} label={resolvedLabels.transcript.typing} />
      <ErrorRow
        error={error}
        rawError={rawError}
        retryLabel={resolvedLabels.transcript.retry}
        dismissLabel={resolvedLabels.transcript.dismissError}
        onRetry={onRetry}
        onDismissError={onDismissError}
        renderError={renderError}
      />
      <JumpToBottomButton
        show={shouldRenderJumpToBottom}
        label={resolvedLabels.transcript.jumpToLatest}
        onClick={scrollToBottom}
      />
    </div>
  );
}

export const ChatWindow = React.forwardRef(ChatWindowInner) as <TMeta = Record<string, unknown>>(
  props: ChatWindowProps<TMeta> & React.RefAttributes<HTMLDivElement>,
) => React.ReactElement | null;

(ChatWindow as React.NamedExoticComponent).displayName = 'ChatWindow';
