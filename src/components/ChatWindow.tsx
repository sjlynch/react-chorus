import React from 'react';
import type { Message, Role } from '../types';
import { resolveChorusLabels } from '../labels/resolve';
import type { ChorusLabels, ResolvedChorusLabels } from '../labels/types';
import { ToolCallBlock } from './ToolCallBlock';
import { MessageActionControls, MessageRenderStateContext, MessageRenderStateProvider, MessageRow, MessageSpeakerLabel } from './MessageRow';
import type { GetMessageFeedback, MessageBubbleSlots, MessageCopyResult, MessageFeedback, MessageMarkdownProps, MessageRenderActions } from './MessageRow';
import type { MarkdownSanitizer } from './Markdown';
import { canWriteTextToClipboard, writeTextToClipboard } from '../utils/messageCopy';
import { visibleActivityKey } from './chat-window/activityKey';
import { useMessageFeedbackState } from './chat-window/feedback';
import { attachMessageRootProps, DefaultEmptyState } from './chat-window/rendering';
import { useAutoScroll } from './chat-window/useAutoScroll';

export { stringActivityKey } from './chat-window/activityKey';
export { MessageBubble } from './MessageRow';
export type { GetMessageFeedback, MessageBubbleProps, MessageBubbleSlots, MessageCopyResult, MessageFeedback, MessageMarkdownProps, MessageRenderActions } from './MessageRow';

const DEFAULT_HIDDEN_ROLES: Role[] = ['system', 'tool'];
const NO_HIDDEN_ROLES: Role[] = [];
let didWarnShowSystemMessages = false;

// Keep this local so hook-only chunks do not share a dev-mode module with ChatWindow.
function isChorusDevMode() {
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

function noop() {}

function normalizeMaxRenderedMessages(maxRenderedMessages: number | undefined) {
  if (maxRenderedMessages === undefined) return null;
  if (!Number.isFinite(maxRenderedMessages)) return null;
  return Math.max(0, Math.floor(maxRenderedMessages));
}

export interface RenderErrorContext {
  error: string;
  rawError: Error | null;
  retry: () => void;
  dismiss: () => void;
}

export interface RenderMessageRootProps {
  'data-chorus-message-id': string;
}

export interface RenderMessageContext<TMeta = Record<string, unknown>> {
  isStreaming: boolean;
  /**
   * True while this message's built-in inline editor is active. Skip rendering your own bubble/content
   * when true so the editor replaces the row instead of rendering alongside the original content.
   */
  isEditing: boolean;
  defaultRender: (slots?: MessageBubbleSlots) => React.ReactNode;
  actions: MessageRenderActions;
  message: Message<TMeta>;
  /** Spread on a custom row root so ChorusRef.scrollToMessage can target it. */
  messageProps: RenderMessageRootProps;
}

export interface ChatWindowProps<TMeta = Record<string, unknown>> extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onCopy'> {
  codeTheme?: 'dark' | 'light';
  emptyState?: React.ReactNode;
  error?: string | null;
  headless?: boolean;
  /** Message roles hidden from the transcript. Defaults to ['system', 'tool']; pass ['system'] to show tool calls while hiding system prompts, or [] to show every role. */
  hiddenRoles?: Role[];
  /** Props forwarded to the built-in Markdown renderer for message text. */
  markdownProps?: MessageMarkdownProps;
  /** Convenience alias for markdownProps.sanitizer. Takes precedence when both are provided. */
  markdownSanitizer?: MarkdownSanitizer;
  /** Render only the latest N visible messages. Typing and error rows still render outside this message window. */
  maxRenderedMessages?: number;
  messages: Message<TMeta>[];
  /** Return a persisted feedback selection for a message. If omitted or undefined, message.metadata.feedback seeds the built-in thumb state when it is 'up' or 'down'. */
  getMessageFeedback?: GetMessageFeedback<TMeta>;
  /**
   * Overrides the built-in per-message Copy action. Return false (or Promise<false>)
   * to show the Copy failed indicator; return void to keep historical assume-success behavior.
   */
  onCopy?: (message: Message<TMeta>) => MessageCopyResult;
  onDelete?: (id: string) => void;
  onDismissError?: () => void;
  onEdit?: (id: string, newText: string) => void;
  /** Built-in controls call this only when the chosen variant differs from the current selection; clicks do not toggle feedback off. */
  onFeedback?: (message: Message<TMeta>, feedback: MessageFeedback) => void;
  onRegenerate?: (id: string) => void;
  onRetry?: () => void;
  onSuggestedPrompt?: (prompt: string) => void;
  rawError?: Error | null;
  renderError?: (context: RenderErrorContext) => React.ReactNode;
  renderMessage?: (message: Message<TMeta>, context: RenderMessageContext<TMeta>) => React.ReactNode;
  showJumpToBottomButton?: boolean;
  /** @deprecated Use hiddenRoles instead. When hiddenRoles is omitted, true is equivalent to hiddenRoles={[]} and false keeps the default ['system', 'tool']. */
  showSystemMessages?: boolean;
  /** Internal optimization hint: render the active assistant message as escaped plain text until it finalizes. */
  streamingMessageId?: string | null;
  suggestedPrompts?: string[];
  /** Disable default empty-state prompt buttons without hiding them. */
  suggestedPromptsDisabled?: boolean;
  suggestedPromptsDisabledReason?: string;
  typing?: boolean;
  /** Localized labels for the transcript, message actions, speakers, tool calls, reasoning, and code copy. Defaults to English. */
  labels?: ChorusLabels;
}

interface MessageRenderSlotProps<TMeta> {
  message: Message<TMeta>;
  isStreaming: boolean;
  defaultRender: (slots?: MessageBubbleSlots) => React.ReactNode;
  actions: MessageRenderActions;
  messageProps: RenderMessageRootProps;
  renderMessage?: (message: Message<TMeta>, context: RenderMessageContext<TMeta>) => React.ReactNode;
}

function MessageRenderSlot<TMeta>({ message, isStreaming, defaultRender, actions, messageProps, renderMessage }: MessageRenderSlotProps<TMeta>) {
  const renderState = React.useContext(MessageRenderStateContext);
  const isEditing = renderState?.messageId === message.id ? renderState.isEditing : false;
  if (!renderMessage) return <>{defaultRender()}</>;

  const context: RenderMessageContext<TMeta> = { isStreaming, isEditing, defaultRender, actions, message, messageProps };
  const custom = renderMessage(message, context);
  if (custom == null) return <>{defaultRender()}</>;
  return <>{attachMessageRootProps(custom, messageProps)}</>;
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
  streamingMessageId,
  suggestedPrompts,
  suggestedPromptsDisabled = false,
  suggestedPromptsDisabledReason,
  labels,
  className,
  style,
  ...rest
}: ChatWindowProps<TMeta>, ref: React.ForwardedRef<HTMLDivElement>) {
  const resolvedLabels: ResolvedChorusLabels = React.useMemo(() => resolveChorusLabels(labels), [labels]);
  React.useEffect(() => {
    if (!isChorusDevMode() || showSystemMessages === undefined || didWarnShowSystemMessages) return;
    console.warn('[Chorus] `showSystemMessages` is deprecated. Use `hiddenRoles` instead (for example hiddenRoles={[\'system\']} to show tool messages while hiding system prompts).');
    didWarnShowSystemMessages = true;
  }, [showSystemMessages]);

  const effectiveHiddenRoles = hiddenRoles ?? (showSystemMessages ? NO_HIDDEN_ROLES : DEFAULT_HIDDEN_ROLES);
  const hiddenRoleSet = React.useMemo(() => new Set<Role>(effectiveHiddenRoles), [effectiveHiddenRoles]);
  const visible = React.useMemo(() => messages.filter(m => !hiddenRoleSet.has(m.role)), [messages, hiddenRoleSet]);
  const normalizedMaxRenderedMessages = React.useMemo(() => normalizeMaxRenderedMessages(maxRenderedMessages), [maxRenderedMessages]);
  const renderedVisible = React.useMemo(() => {
    if (normalizedMaxRenderedMessages === null) return visible;
    if (normalizedMaxRenderedMessages === 0) return [];
    return visible.slice(-normalizedMaxRenderedMessages);
  }, [normalizedMaxRenderedMessages, visible]);
  const copyAvailable = Boolean(onCopy) || canWriteTextToClipboard();
  const copyMessage = React.useCallback((message: Message<TMeta>): MessageCopyResult => {
    if (onCopy) return onCopy(message);

    return writeTextToClipboard(message.text ?? '');
  }, [onCopy]);
  const { getSelectedFeedback, handleMessageFeedback } = useMessageFeedbackState({ messages, getMessageFeedback, onFeedback });
  const activityKey = React.useMemo(() => visibleActivityKey(visible, typing, streamingMessageId, error), [visible, typing, streamingMessageId, error]);
  const { windowRef, hasUnreadActivity, isAutoScrollPaused, scrollToBottom } = useAutoScroll<HTMLDivElement>(activityKey, ref);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const hasEmptyTranscript = visible.length === 0 && !typing;
  const suggestedPromptList = suggestedPrompts ?? [];
  const shouldRenderSuggestedPrompts = hasEmptyTranscript && emptyState === undefined && suggestedPromptList.length > 0;
  const shouldRenderJumpToBottom = showJumpToBottomButton && isAutoScrollPaused && hasUnreadActivity;

  return (
    <div
      {...rest}
      className={["chorus-window", className].filter(Boolean).join(" ")}
      style={style}
      ref={windowRef}
      role="log"
      aria-live="polite"
      aria-label={resolvedLabels.transcript.ariaLabel}
    >
      {renderedVisible.map(m => {
        const isStreaming = m.id === streamingMessageId;
        const initialFeedback = getSelectedFeedback(m);
        const feedback = onFeedback ? (variant: MessageFeedback) => handleMessageFeedback(m, variant) : undefined;
        const defaultRender = (slots?: MessageBubbleSlots) => {
          if (m.role === 'tool') {
            return (
              <div className="chorus-msg chorus-tool" data-chorus-message-id={m.id}>
                <MessageSpeakerLabel role={m.role} speakers={resolvedLabels.speakers} />
                {slots?.before}
                <ToolCallBlock toolCall={m.toolCall} labels={resolvedLabels.toolCall} />
                {slots?.after}
              </div>
            );
          }

          return (
            <MessageRow
              m={m}
              codeTheme={codeTheme}
              headless={headless}
              streaming={isStreaming}
              markdownProps={markdownProps}
              markdownSanitizer={markdownSanitizer}
              messageActionLabels={resolvedLabels.messageActions}
              speakerLabels={resolvedLabels.speakers}
              reasoningLabel={resolvedLabels.reasoning}
              codeCopyLabels={resolvedLabels.codeCopy}
              attachmentLabels={resolvedLabels.attachments}
              onEdit={onEdit}
              onRegenerate={onRegenerate}
              onDelete={onDelete}
              onCopy={copyAvailable ? copyMessage : undefined}
              onFeedback={feedback ? (_message, variant) => feedback(variant) : undefined}
              initialFeedback={initialFeedback}
              {...slots}
            />
          );
        };
        const actions: MessageRenderActions = {
          canEdit: Boolean(m.role === 'user' && onEdit),
          canRegenerate: Boolean(m.role === 'assistant' && onRegenerate),
          canDelete: Boolean(onDelete),
          edit: m.role === 'user' && onEdit ? (newText) => {
            const trimmed = newText.trim();
            if (trimmed) onEdit(m.id, trimmed);
          } : undefined,
          regenerate: m.role === 'assistant' && onRegenerate ? () => onRegenerate(m.id) : undefined,
          delete: onDelete ? () => onDelete(m.id) : undefined,
          copy: copyAvailable ? () => copyMessage(m) : undefined,
          feedback,
          initialFeedback,
          defaultRender: () => <MessageActionControls message={m} actions={actions} labels={resolvedLabels.messageActions} speakerLabels={resolvedLabels.speakers} />,
        };
        const messageProps: RenderMessageRootProps = { 'data-chorus-message-id': m.id };

        return (
          <MessageRenderStateProvider key={m.id} messageId={m.id}>
            <MessageRenderSlot
              message={m}
              isStreaming={isStreaming}
              defaultRender={defaultRender}
              actions={actions}
              messageProps={messageProps}
              renderMessage={renderMessage}
            />
          </MessageRenderStateProvider>
        );
      })}

      {hasEmptyTranscript && emptyState !== undefined && (
        <div className="chorus-empty-state">{emptyState}</div>
      )}
      {shouldRenderSuggestedPrompts && (
        <DefaultEmptyState
          prompts={suggestedPromptList}
          onSuggestedPrompt={onSuggestedPrompt}
          disabled={suggestedPromptsDisabled}
          disabledReason={suggestedPromptsDisabledReason}
          title={resolvedLabels.transcript.emptyStateTitle}
          ariaLabel={resolvedLabels.transcript.suggestedPromptsAriaLabel}
        />
      )}

      {typing &&
        <div className="chorus-msg chorus-assistant chorus-typing" role="status" aria-label={resolvedLabels.transcript.typing}>
          <div className="chorus-bubble" aria-hidden="true"><span className="chorus-dot"></span><span className="chorus-dot"></span><span className="chorus-dot"></span></div>
        </div>
      }
      {error && (renderError ? (
        <>{renderError({ error, rawError, retry: onRetry ?? noop, dismiss: onDismissError ?? noop })}</>
      ) : (
        <div className="chorus-error" role="alert">
          <span className="chorus-error-text">{error}</span>
          {onRetry && <button type="button" className="chorus-retry-btn" onClick={onRetry}>{resolvedLabels.transcript.retry}</button>}
        </div>
      ))}
      {shouldRenderJumpToBottom && (
        <button type="button" className="chorus-jump-to-bottom" onClick={scrollToBottom}>
          {resolvedLabels.transcript.jumpToLatest}
        </button>
      )}
      <div ref={bottomRef} className="chorus-scroll-sentinel" aria-hidden="true" />
    </div>
  );
}

export const ChatWindow = React.forwardRef(ChatWindowInner) as <TMeta = Record<string, unknown>>(
  props: ChatWindowProps<TMeta> & React.RefAttributes<HTMLDivElement>,
) => React.ReactElement | null;

(ChatWindow as React.NamedExoticComponent).displayName = 'ChatWindow';
