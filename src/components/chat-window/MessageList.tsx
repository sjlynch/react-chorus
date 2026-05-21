import React from 'react';
import type { ResolvedChorusLabels } from '../../labels/types';
import type { Message } from '../../types';
import type { MarkdownSanitizer } from '../Markdown';
import { MessageActionControls, MessageRenderStateContext, MessageRenderStateProvider, MessageRow, MessageSpeakerLabel } from '../MessageRow';
import type { MessageBubbleSlots, MessageCopyResult, MessageFeedback, MessageMarkdownProps, MessageRenderActions, MessageTimestampFormatter } from '../MessageRow';
import { ToolCallBlock } from '../ToolCallBlock';
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

  const context: RenderMessageContext<TMeta> = { isStreaming, isEditing, defaultRender, actions, message, messageProps };
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
  renderMessage?: (message: Message<TMeta>, context: RenderMessageContext<TMeta>) => React.ReactNode;
  /** Render each message's `createdAt` time below its bubble. */
  showTimestamps: boolean;
  /** Override the locale-aware default timestamp formatting. */
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
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
  renderMessage,
  showTimestamps,
  formatTimestamp,
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
  // Tool messages never carry the `streamingMessageId` themselves (that tracks
  // the pending assistant message), so derive turn membership from position.
  // An assistant turn is in flight whenever `sessionStreaming` is true, and the
  // streaming turn is every message after the last user message. A tool call
  // only counts as streaming when it sits inside that trailing turn — flagging
  // *every* tool row instead would flip an older, already-finished empty-bodied
  // tool call to "Running…" the moment an unrelated later turn streams.
  const sessionStreaming = streamingMessageId != null;
  const lastUserIndex = sessionStreaming
    ? messages.reduce((last, m, i) => (m.role === 'user' ? i : last), -1)
    : -1;

  return (
    <>
      {messages.map((message, index) => {
        const isStreaming = message.id === streamingMessageId;
        // A tool row may show "Running…" only while it belongs to the in-flight
        // turn — i.e. it trails the last user message during a streaming turn.
        const toolStreaming = sessionStreaming && index > lastUserIndex;
        const initialFeedback = getSelectedFeedback(message);
        const feedback = feedbackEnabled ? (variant: MessageFeedback | null) => onMessageFeedback(message, variant) : undefined;
        const defaultRender = (slots?: MessageBubbleSlots) => {
          if (message.role === 'tool') {
            return (
              <div className="chorus-msg chorus-tool" data-chorus-message-id={message.id}>
                <MessageSpeakerLabel role={message.role} speakers={resolvedLabels.speakers} />
                {slots?.before}
                {slots?.headerSlot}
                <ToolCallBlock toolCall={message.toolCall} labels={resolvedLabels.toolCall} streaming={toolStreaming} />
                {slots?.footerSlot}
                {slots?.after}
              </div>
            );
          }

          return (
            <MessageRow
              m={message}
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
              showTimestamp={showTimestamps}
              formatTimestamp={formatTimestamp}
              onEdit={onEdit}
              onRegenerate={onRegenerate}
              onDelete={onDelete}
              onCopy={copyAvailable ? copyMessage : undefined}
              onFeedback={feedback ? (_message, variant) => feedback(variant) : undefined}
              initialFeedback={initialFeedback}
              feedbackReadOnly={feedbackReadOnly}
              {...slots}
            />
          );
        };
        const actions: MessageRenderActions = {
          canEdit: Boolean(message.role === 'user' && onEdit),
          canRegenerate: Boolean(message.role === 'assistant' && onRegenerate),
          canDelete: Boolean(onDelete),
          // Pass through unchanged: trimming/empty-drop is owned solely by
          // InlineMessageEditor.submitEdit so onEdit's contract is consistent.
          edit: message.role === 'user' && onEdit ? (newText) => onEdit(message.id, newText) : undefined,
          regenerate: message.role === 'assistant' && onRegenerate ? () => onRegenerate(message.id) : undefined,
          delete: onDelete ? () => onDelete(message.id) : undefined,
          copy: copyAvailable ? () => copyMessage(message) : undefined,
          feedback,
          initialFeedback,
          feedbackReadOnly,
          defaultRender: () => <MessageActionControls message={message} actions={actions} labels={resolvedLabels.messageActions} speakerLabels={resolvedLabels.speakers} />,
        };
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
