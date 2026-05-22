import React from 'react';
import type { ResolvedChorusLabels } from '../../labels/types';
import type { Message } from '../../types';
import type { MarkdownSanitizer } from '../Markdown';
import { MessageActionControls, MessageRow } from '../MessageRow';
import type { MessageBubbleSlots, MessageCopyResult, MessageFeedback, MessageMarkdownProps, MessageRenderActions, MessageTimestampFormatter } from '../MessageRow';

interface MessageDefaultRenderOptions<TMeta> {
  message: Message<TMeta>;
  codeTheme: 'dark' | 'light';
  headless: boolean;
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
  resolvedLabels: ResolvedChorusLabels;
  /** Whether this message is the in-flight streaming assistant message. */
  isStreaming: boolean;
  /** Whether a tool row belongs to the in-flight turn and may show "Running…". */
  toolStreaming: boolean;
  showTimestamps: boolean;
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
  onEdit?: (id: string, newText: string) => void;
  onRegenerate?: (id: string) => void;
  onDelete?: (id: string) => void;
  copyAvailable: boolean;
  copyMessage: (message: Message<TMeta>) => MessageCopyResult;
  feedback?: (variant: MessageFeedback | null) => void;
  initialFeedback: MessageFeedback | null;
  feedbackReadOnly: boolean;
}

/**
 * Builds the `defaultRender` slot function for one message. All roles flow
 * through `MessageRow` so tool rows get the same actions, timestamps, and
 * feedback affordances as user/assistant rows. Returns the same `(slots?) => ReactNode` callback the
 * `renderMessage` contract exposes via `RenderMessageContext`.
 */
export function buildMessageDefaultRender<TMeta = Record<string, unknown>>({
  message,
  codeTheme,
  headless,
  markdownProps,
  markdownSanitizer,
  resolvedLabels,
  isStreaming,
  toolStreaming,
  showTimestamps,
  formatTimestamp,
  onEdit,
  onRegenerate,
  onDelete,
  copyAvailable,
  copyMessage,
  feedback,
  initialFeedback,
  feedbackReadOnly,
}: MessageDefaultRenderOptions<TMeta>): (slots?: MessageBubbleSlots) => React.ReactNode {
  return (slots?: MessageBubbleSlots) => {
    const rowStreaming = message.role === 'tool' ? toolStreaming : isStreaming;
    return (
      <MessageRow
        m={message}
        codeTheme={codeTheme}
        headless={headless}
        streaming={rowStreaming}
        markdownProps={markdownProps}
        markdownSanitizer={markdownSanitizer}
        messageActionLabels={resolvedLabels.messageActions}
        speakerLabels={resolvedLabels.speakers}
        reasoningLabel={resolvedLabels.reasoning}
        codeCopyLabels={resolvedLabels.codeCopy}
        attachmentLabels={resolvedLabels.attachments}
        sourceLabels={resolvedLabels.sources}
        toolCallLabels={resolvedLabels.toolCall}
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
}

interface MessageRenderActionsOptions<TMeta> {
  message: Message<TMeta>;
  resolvedLabels: ResolvedChorusLabels;
  onEdit?: (id: string, newText: string) => void;
  onRegenerate?: (id: string) => void;
  onDelete?: (id: string) => void;
  copyAvailable: boolean;
  copyMessage: (message: Message<TMeta>) => MessageCopyResult;
  feedback?: (variant: MessageFeedback | null) => void;
  initialFeedback: MessageFeedback | null;
  feedbackReadOnly: boolean;
}

/**
 * Builds the `MessageRenderActions` object exposed to `renderMessage` for one
 * message: capability flags, the edit/regenerate/delete/copy/feedback handlers,
 * and a `defaultRender` that renders the built-in `MessageActionControls`.
 */
export function buildMessageRenderActions<TMeta = Record<string, unknown>>({
  message,
  resolvedLabels,
  onEdit,
  onRegenerate,
  onDelete,
  copyAvailable,
  copyMessage,
  feedback,
  initialFeedback,
  feedbackReadOnly,
}: MessageRenderActionsOptions<TMeta>): MessageRenderActions {
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
  return actions;
}
