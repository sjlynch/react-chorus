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
  getSelectedFeedback: (message: Message<TMeta>) => MessageFeedback | null;
  onMessageFeedback: (message: Message<TMeta>, feedback: MessageFeedback) => void;
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
  getSelectedFeedback,
  onMessageFeedback,
  onDelete,
  onEdit,
  onRegenerate,
}: MessageListProps<TMeta>) {
  return (
    <>
      {messages.map(message => {
        const isStreaming = message.id === streamingMessageId;
        const initialFeedback = getSelectedFeedback(message);
        const feedback = feedbackEnabled ? (variant: MessageFeedback) => onMessageFeedback(message, variant) : undefined;
        const defaultRender = (slots?: MessageBubbleSlots) => {
          if (message.role === 'tool') {
            return (
              <div className="chorus-msg chorus-tool" data-chorus-message-id={message.id}>
                <MessageSpeakerLabel role={message.role} speakers={resolvedLabels.speakers} />
                {slots?.before}
                <ToolCallBlock toolCall={message.toolCall} labels={resolvedLabels.toolCall} />
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
              {...slots}
            />
          );
        };
        const actions: MessageRenderActions = {
          canEdit: Boolean(message.role === 'user' && onEdit),
          canRegenerate: Boolean(message.role === 'assistant' && onRegenerate),
          canDelete: Boolean(onDelete),
          edit: message.role === 'user' && onEdit ? (newText) => {
            const trimmed = newText.trim();
            if (trimmed) onEdit(message.id, trimmed);
          } : undefined,
          regenerate: message.role === 'assistant' && onRegenerate ? () => onRegenerate(message.id) : undefined,
          delete: onDelete ? () => onDelete(message.id) : undefined,
          copy: copyAvailable ? () => copyMessage(message) : undefined,
          feedback,
          initialFeedback,
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
