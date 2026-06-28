import React from 'react';
import type { ResolvedChorusLabels } from '../../labels/types';
import type { Message, Role } from '../../types';
import type { MarkdownSanitizer } from '../Markdown';
import { MessageRenderStateContext, MessageRenderStateProvider } from '../MessageRow';
import type { MessageBubbleSlots, MessageCopyResult, MessageFeedback, MessageMarkdownProps, MessageRenderActions, MessageTimestampFormatter } from '../MessageRow';
import { buildMessageDefaultRender, buildMessageRenderActions } from './messageRenderBuilders';
import { attachMessageRootProps } from './rendering';
import type { RenderMessageContext, RenderMessageRootProps } from './types';

interface MessageRenderSlotProps<TMeta> {
  message: Message<TMeta>;
  isStreaming: boolean;
  defaultRender: (slots?: MessageBubbleSlots) => React.ReactNode;
  actions: MessageRenderActions;
  messageProps: RenderMessageRootProps;
  renderMessage?: (message: Message<TMeta>, context: RenderMessageContext<TMeta>) => React.ReactNode;
}

export function MessageRenderSlot<TMeta = Record<string, unknown>>({ message, isStreaming, defaultRender, actions, messageProps, renderMessage }: MessageRenderSlotProps<TMeta>) {
  const renderState = React.useContext(MessageRenderStateContext);
  const isEditing = renderState?.messageId === message.id ? renderState.isEditing : false;
  if (!renderMessage) return <>{defaultRender()}</>;

  const context: RenderMessageContext<TMeta> = { isStreaming, isEditing, defaultRender, actions, sources: message.sources ?? [], message, messageProps };
  const custom = renderMessage(message, context);
  if (custom == null) return <>{defaultRender()}</>;
  return <>{attachMessageRootProps(custom, messageProps)}</>;
}

export interface MessageListProps<TMeta = Record<string, unknown>> {
  messages: Message<TMeta>[];
  codeTheme: 'dark' | 'light';
  headless: boolean;
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
  streamingMessageId?: string | null;
  /**
   * Ids of the messages in the in-flight streaming turn (every message after
   * the last user message), computed by `ChatWindow` over the full visible
   * array before windowing. A tool row shows "Running…" only while its id is
   * in this set, which stays correct even when `maxRenderedMessages` slices
   * the last user message (or the streaming message) out of the window.
   */
  streamingTurnIds: ReadonlySet<string>;
  renderMessage?: (message: Message<TMeta>, context: RenderMessageContext<TMeta>) => React.ReactNode;
  /** Optional meta-line renderer placed under each bubble (e.g. cost chip). */
  renderMessageFooter?: (message: Message<TMeta>) => React.ReactNode;
  /** Render each message's `createdAt` time below its bubble. */
  showTimestamps: boolean;
  /** Message roles whose bubbles expose the inline edit action (default `['user']`). */
  editableRoles: Role[];
  /** Override the locale-aware default timestamp formatting. */
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
  /** Render the optional `message.speaker.avatarUrl` as a small circular avatar. */
  showSpeakerAvatars: boolean;
  resolvedLabels: ResolvedChorusLabels;
  copyAvailable: boolean;
  copyMessage: (message: Message<TMeta>) => MessageCopyResult;
  feedbackEnabled: boolean;
  /** Render recorded feedback as inert thumbs (getMessageFeedback set, no onFeedback). */
  feedbackReadOnly: boolean;
  getSelectedFeedback: (message: Message<TMeta>) => MessageFeedback | null;
  onMessageFeedback: (message: Message<TMeta>, feedback: MessageFeedback | null) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string, newText: string) => void;
  onRegenerate?: (id: string) => void;
}

export function MessageList<TMeta = Record<string, unknown>>({
  messages,
  codeTheme,
  headless,
  markdownProps,
  markdownSanitizer,
  streamingMessageId,
  streamingTurnIds,
  renderMessage,
  renderMessageFooter,
  showTimestamps,
  editableRoles,
  formatTimestamp,
  showSpeakerAvatars,
  resolvedLabels,
  copyAvailable,
  copyMessage,
  feedbackEnabled,
  feedbackReadOnly,
  getSelectedFeedback,
  onMessageFeedback,
  onDelete,
  onEdit,
  onRegenerate,
}: MessageListProps<TMeta>) {
  return (
    <>
      {messages.map((message) => {
        const isStreaming = message.id === streamingMessageId;
        // Tool messages never carry the `streamingMessageId` themselves (that
        // tracks the pending assistant message), so a tool row shows "Running…"
        // only while it belongs to the in-flight turn. `ChatWindow` derives
        // that turn — every message after the last user message — from the full
        // pre-window array, so this stays correct even when `maxRenderedMessages`
        // slices the last user message out of the rendered window.
        const toolStreaming = streamingTurnIds.has(message.id);
        const initialFeedback = getSelectedFeedback(message);
        const feedback = feedbackEnabled ? (variant: MessageFeedback | null) => onMessageFeedback(message, variant) : undefined;
        const defaultRender = buildMessageDefaultRender<TMeta>({
          message,
          codeTheme,
          headless,
          markdownProps,
          markdownSanitizer,
          resolvedLabels,
          isStreaming,
          toolStreaming,
          showTimestamps,
          editableRoles,
          formatTimestamp,
          showSpeakerAvatars,
          onEdit,
          onRegenerate,
          onDelete,
          copyAvailable,
          copyMessage,
          feedback,
          initialFeedback,
          feedbackReadOnly,
          renderMessageFooter,
        });
        const actions = buildMessageRenderActions<TMeta>({
          message,
          resolvedLabels,
          editableRoles,
          onEdit,
          onRegenerate,
          onDelete,
          copyAvailable,
          copyMessage,
          feedback,
          initialFeedback,
          feedbackReadOnly,
        });
        const messageProps: RenderMessageRootProps = { 'data-chorus-message-id': message.id };

        return (
          <MessageRenderStateProvider key={message.id} messageId={message.id}>
            <MessageRenderSlot
              message={message}
              isStreaming={isStreaming}
              defaultRender={defaultRender}
              actions={actions}
              messageProps={messageProps}
              renderMessage={renderMessage}
            />
          </MessageRenderStateProvider>
        );
      })}
    </>
  );
}
