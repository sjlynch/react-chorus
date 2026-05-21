import React from 'react';
import type { ResolvedChorusLabels } from '../../labels/types';
import type { Message } from '../../types';
import { Markdown, type MarkdownSanitizer } from '../Markdown';
import { MessageActionControls, MessageRow, MessageSpeakerLabel } from '../MessageRow';
import type { MessageBubbleSlots, MessageCopyResult, MessageFeedback, MessageMarkdownProps, MessageRenderActions, MessageTimestampFormatter } from '../MessageRow';
import { ToolCallBlock } from '../ToolCallBlock';

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
 * Builds the `defaultRender` slot function for one message: the tool-message
 * branch (host-authored summary text plus `ToolCallBlock`) versus the standard
 * `MessageRow`. Returns the same `(slots?) => ReactNode` callback the
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
    if (message.role === 'tool') {
      // `ToolMessage.text` is an optional host-authored summary of the tool
      // result (see types.ts). Render it above the call block as finalized
      // Markdown so a populated `text` is visible instead of silently
      // dropped. It is not incrementally streamed by Chorus, so it is
      // always parsed (streaming=false) regardless of the turn state.
      const toolText = message.text ?? '';
      const hasToolText = toolText.trim().length > 0;
      return (
        <div className="chorus-msg chorus-tool" data-chorus-message-id={message.id}>
          <MessageSpeakerLabel role={message.role} speakers={resolvedLabels.speakers} />
          {slots?.before}
          {slots?.headerSlot}
          {hasToolText && (
            <div className="chorus-bubble">
              <Markdown
                {...markdownProps}
                text={toolText}
                codeTheme={codeTheme}
                headless={headless}
                streaming={false}
                sanitizer={markdownSanitizer ?? markdownProps?.sanitizer}
                codeCopyLabels={resolvedLabels.codeCopy ?? markdownProps?.codeCopyLabels}
              />
            </div>
          )}
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
