import React from 'react';
import type { Message, Role } from '../types';
import { ToolCallBlock } from './ToolCallBlock';
import { getInitialMessageFeedback, MessageActionControls, MessageRenderStateProvider, MessageRow, MessageSpeakerLabel } from './MessageRow';
import type { GetMessageFeedback, MessageBubbleSlots, MessageFeedback, MessageMarkdownProps, MessageRenderActions } from './MessageRow';
import type { MarkdownSanitizer } from './Markdown';
import { isChorusDevMode } from '../utils/devMode';
import { canWriteTextToClipboard, writeTextToClipboard } from '../utils/messageCopy';

export { MessageBubble } from './MessageRow';
export type { GetMessageFeedback, MessageBubbleProps, MessageBubbleSlots, MessageFeedback, MessageMarkdownProps, MessageRenderActions } from './MessageRow';

const DEFAULT_HIDDEN_ROLES: Role[] = ['system', 'tool'];
const NO_HIDDEN_ROLES: Role[] = [];
const SCROLL_BOTTOM_THRESHOLD_PX = 48;
let didWarnShowSystemMessages = false;

function isNearBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD_PX;
}

function noop() {}

function normalizeMaxRenderedMessages(maxRenderedMessages: number | undefined) {
  if (maxRenderedMessages === undefined) return null;
  if (!Number.isFinite(maxRenderedMessages)) return null;
  return Math.max(0, Math.floor(maxRenderedMessages));
}

const objectActivityIds = new WeakMap<object, number>();
let nextObjectActivityId = 1;

function objectActivityKey(value: object) {
  let id = objectActivityIds.get(value);
  if (!id) {
    id = nextObjectActivityId;
    nextObjectActivityId += 1;
    objectActivityIds.set(value, id);
  }
  return `o:${id}`;
}

function stringActivityKey(value: string) {
  return `s:${value.length}:${value.slice(0, 24)}:${value.slice(-24)}`;
}

function unknownActivityKey(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'string') return stringActivityKey(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return `${typeof value}:${String(value)}`;
  if (typeof value === 'symbol') return `symbol:${String(value.description ?? '')}`;
  if (typeof value === 'function') return objectActivityKey(value);
  if (typeof value === 'object') return objectActivityKey(value);
  return typeof value;
}

function attachmentActivityKey(attachment: NonNullable<Message['attachments']>[number]) {
  const source = attachment.url ?? attachment.id ?? attachment.data ?? '';
  return [
    attachment.name,
    attachment.type,
    attachment.size,
    stringActivityKey(source),
    unknownActivityKey(attachment.metadata),
  ].join(',');
}

function messageActivityKey<TMeta>(message: Message<TMeta>) {
  const toolCall = message.toolCall;
  return [
    message.id,
    message.role,
    stringActivityKey(message.text),
    stringActivityKey(message.reasoning ?? ''),
    message.attachments?.length ?? 0,
    ...(message.attachments?.map(attachmentActivityKey) ?? []),
    toolCall?.id ?? '',
    toolCall?.name ?? '',
    toolCall && Object.prototype.hasOwnProperty.call(toolCall, 'input') ? 'input' : '',
    unknownActivityKey(toolCall?.input),
    toolCall && Object.prototype.hasOwnProperty.call(toolCall, 'output') ? 'output' : '',
    unknownActivityKey(toolCall?.output),
  ].join('~');
}

function visibleActivityKey<TMeta>(visible: Message<TMeta>[], typing: boolean | undefined, streamingMessageId: string | null | undefined, error: string | null | undefined) {
  return [
    visible.length,
    ...visible.map(messageActivityKey),
    typing ? 'typing' : '',
    streamingMessageId ?? '',
    error ?? '',
  ].join('|');
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
  onCopy?: (message: Message<TMeta>) => void;
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
}

function DefaultEmptyState({ prompts, onSuggestedPrompt, disabled = false, disabledReason }: {
  prompts: string[];
  onSuggestedPrompt?: (prompt: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div className="chorus-empty-state chorus-empty-state-default">
      <div className="chorus-empty-title">How can I help?</div>
      <div className="chorus-suggested-prompts" aria-label="Suggested prompts">
        {prompts.map(prompt => (
          <button
            key={prompt}
            type="button"
            className="chorus-suggested-prompt"
            onClick={() => { if (!disabled) onSuggestedPrompt?.(prompt); }}
            disabled={disabled}
            aria-disabled={disabled || undefined}
            title={disabled ? disabledReason : undefined}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function attachMessageRootProps(node: React.ReactNode, messageProps: RenderMessageRootProps) {
  if (!React.isValidElement(node) || typeof node.type !== 'string') return node;

  const props = node.props as Partial<RenderMessageRootProps>;
  if (props['data-chorus-message-id'] != null) return node;

  return React.cloneElement(
    node as React.ReactElement<Record<string, unknown>>,
    messageProps as unknown as Partial<Record<string, unknown>>,
  );
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
  className,
  style,
  ...rest
}: ChatWindowProps<TMeta>, ref: React.ForwardedRef<HTMLDivElement>) {
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
  const copyMessage = React.useCallback((message: Message<TMeta>) => {
    if (onCopy) {
      onCopy(message);
      return;
    }

    writeTextToClipboard(message.text);
  }, [onCopy]);
  const [feedbackOverrides, setFeedbackOverrides] = React.useState<Record<string, MessageFeedback>>({});
  const feedbackOverridesRef = React.useRef(feedbackOverrides);

  React.useEffect(() => {
    feedbackOverridesRef.current = feedbackOverrides;
  }, [feedbackOverrides]);

  React.useEffect(() => {
    const messageIds = new Set(messages.map(message => message.id));
    const current = feedbackOverridesRef.current;
    let changed = false;
    const next: Record<string, MessageFeedback> = {};

    for (const [messageId, feedback] of Object.entries(current)) {
      if (messageIds.has(messageId)) next[messageId] = feedback;
      else changed = true;
    }

    if (changed) {
      feedbackOverridesRef.current = next;
      setFeedbackOverrides(next);
    }
  }, [messages]);

  const getSelectedFeedback = React.useCallback((message: Message<TMeta>) => {
    return feedbackOverrides[message.id] ?? getInitialMessageFeedback(message, getMessageFeedback);
  }, [feedbackOverrides, getMessageFeedback]);

  const handleMessageFeedback = React.useCallback((message: Message<TMeta>, variant: MessageFeedback) => {
    const current = feedbackOverridesRef.current[message.id] ?? getInitialMessageFeedback(message, getMessageFeedback);
    if (current === variant) return;

    const next = { ...feedbackOverridesRef.current, [message.id]: variant };
    feedbackOverridesRef.current = next;
    setFeedbackOverrides(next);
    onFeedback?.(message, variant);
  }, [getMessageFeedback, onFeedback]);

  const windowRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = React.useRef(true);

  React.useImperativeHandle(ref, () => windowRef.current!);
  const activityKey = React.useMemo(() => visibleActivityKey(visible, typing, streamingMessageId, error), [visible, typing, streamingMessageId, error]);
  const previousActivityKeyRef = React.useRef(activityKey);
  const [hasUnreadActivity, setHasUnreadActivity] = React.useState(false);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = React.useState(false);

  const scrollToBottom = React.useCallback(() => {
    const el = windowRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    shouldAutoScrollRef.current = true;
    setIsAutoScrollPaused(false);
    setHasUnreadActivity(false);
  }, []);

  React.useEffect(() => {
    const el = windowRef.current;
    if (!el) return;

    const onScroll = () => {
      const nearBottom = isNearBottom(el);
      shouldAutoScrollRef.current = nearBottom;
      setIsAutoScrollPaused(!nearBottom);
      if (nearBottom) setHasUnreadActivity(false);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  React.useEffect(() => {
    if (previousActivityKeyRef.current === activityKey) return;

    if (!shouldAutoScrollRef.current) setHasUnreadActivity(true);
    previousActivityKeyRef.current = activityKey;
  }, [activityKey]);

  React.useLayoutEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    const el = windowRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activityKey]);

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
      aria-label="Chat transcript"
    >
      {renderedVisible.map(m => {
        const isStreaming = m.id === streamingMessageId;
        const initialFeedback = getSelectedFeedback(m);
        const feedback = onFeedback ? (variant: MessageFeedback) => handleMessageFeedback(m, variant) : undefined;
        const defaultRender = (slots?: MessageBubbleSlots) => {
          if (m.role === 'tool' && m.toolCall) {
            return (
              <div className="chorus-msg chorus-tool" data-chorus-message-id={m.id}>
                <MessageSpeakerLabel role={m.role} />
                {slots?.before}
                <ToolCallBlock toolCall={m.toolCall} />
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
          defaultRender: () => <MessageActionControls message={m} actions={actions} />,
        };
        const messageProps: RenderMessageRootProps = { 'data-chorus-message-id': m.id };
        const context: RenderMessageContext<TMeta> = { isStreaming, defaultRender, actions, message: m, messageProps };
        const custom = renderMessage?.(m, context);

        return (
          <MessageRenderStateProvider key={m.id} messageId={m.id}>
            {custom != null ? attachMessageRootProps(custom, messageProps) : defaultRender()}
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
        />
      )}

      {typing &&
        <div className="chorus-msg chorus-assistant chorus-typing" role="status" aria-label="Assistant is typing">
          <div className="chorus-bubble" aria-hidden="true"><span className="chorus-dot"></span><span className="chorus-dot"></span><span className="chorus-dot"></span></div>
        </div>
      }
      {error && (renderError ? (
        <>{renderError({ error, rawError, retry: onRetry ?? noop, dismiss: onDismissError ?? noop })}</>
      ) : (
        <div className="chorus-error" role="alert">
          <span className="chorus-error-text">{error}</span>
          {onRetry && <button type="button" className="chorus-retry-btn" onClick={onRetry}>Retry</button>}
        </div>
      ))}
      {shouldRenderJumpToBottom && (
        <button type="button" className="chorus-jump-to-bottom" onClick={scrollToBottom}>
          ↓ Jump to latest
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
