import React from 'react';
import type { Message, MessageFeedback } from '../types';
import type { ChorusAttachmentLabels, ChorusCodeCopyLabels, ChorusMessageActionLabels, ChorusSpeakerLabels } from '../labels/types';
import { useCanWriteTextToClipboard, writeTextToClipboard } from '../utils/messageCopy';
import type { MarkdownSanitizer } from './Markdown';
import { MessageActions, createCopyAction } from './message-row/actions';
import { MessageBubbleLayout } from './message-row/bubble';
import { getInitialMessageFeedback } from './message-row/feedback';
import { InlineMessageEditor } from './message-row/InlineMessageEditor';
import { useReturnFocusAfterEditing } from './message-row/renderState';
import { MessageSpeakerLabel } from './message-row/speaker';
import type { MessageBubbleSlots, MessageCopyResult, MessageMarkdownProps, MessageRenderActions, MessageTimestampFormatter } from './message-row/types';

export type { MessageFeedback } from '../types';
export { MessageActionControls, MessageActions, actionButtonClass, createCopyAction } from './message-row/actions';
export type { MessageActionsProps } from './message-row/actions';
export { MessageAttachments, MessageBubble, MessageBubbleLayout, MessageReasoning, MessageTimestamp } from './message-row/bubble';
export type { MessageBubbleLayoutProps, MessageBubbleProps, MessageReasoningProps, MessageTimestampProps } from './message-row/bubble';
export { getInitialMessageFeedback, getMetadataFeedback, isMessageFeedback } from './message-row/feedback';
export type { GetMessageFeedback } from './message-row/feedback';
export { InlineMessageEditor } from './message-row/InlineMessageEditor';
export type { InlineMessageEditorProps } from './message-row/InlineMessageEditor';
export { MessageRenderStateContext, MessageRenderStateProvider, useActionEditing } from './message-row/renderState';
export type { MessageRenderStateValue } from './message-row/renderState';
export { getMessageSpeakerLabel, MessageSpeakerLabel } from './message-row/speaker';
export { defaultFormatMessageTimestamp } from './message-row/formatTimestamp';
export type { MessageBubbleSlots, MessageCopyResult, MessageMarkdownProps, MessageRenderActions, MessageTimestampFormatter } from './message-row/types';

export interface MessageRowProps<TMeta = Record<string, unknown>> extends MessageBubbleSlots {
  m: Message<TMeta>;
  codeTheme: 'dark' | 'light';
  headless?: boolean;
  onEdit?: (id: string, newText: string) => void;
  onRegenerate?: (id: string) => void;
  onDelete?: (id: string) => void;
  /**
   * Overrides the built-in message copy action. Return false (or Promise<false>)
   * to show the Copy failed indicator; return void to keep historical assume-success behavior.
   */
  onCopy?: (message: Message<TMeta>) => MessageCopyResult;
  /** Built-in controls call this only when the chosen variant differs from the current selection. */
  onFeedback?: (message: Message<TMeta>, feedback: MessageFeedback) => void;
  /** Seeds the pressed thumb state. When omitted, message.metadata.feedback is used if it is 'up' or 'down'. */
  initialFeedback?: MessageFeedback | null;
  streaming?: boolean;
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
  messageActionLabels?: ChorusMessageActionLabels;
  speakerLabels?: ChorusSpeakerLabels;
  reasoningLabel?: string;
  codeCopyLabels?: ChorusCodeCopyLabels;
  attachmentLabels?: ChorusAttachmentLabels;
  /** Render the message's `createdAt` time below the bubble. Off by default. */
  showTimestamp?: boolean;
  /** Override the locale-aware default timestamp formatting. Only used when `showTimestamp` is true. */
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
}

export function MessageRow<TMeta = Record<string, unknown>>({ m, codeTheme, headless, onEdit, onRegenerate, onDelete, onCopy, onFeedback, initialFeedback, streaming = false, markdownProps, markdownSanitizer, messageActionLabels, speakerLabels, reasoningLabel, codeCopyLabels, attachmentLabels, showTimestamp, formatTimestamp, before, headerSlot, footerSlot, after }: MessageRowProps<TMeta>) {
  const [editing, setEditing] = React.useState(false);
  const editButtonRef = useReturnFocusAfterEditing<HTMLButtonElement>(editing);
  // Defer the navigator.clipboard fallback so the SSR tree (no clipboard)
  // matches the initial client tree. The button appears after the mount
  // effect commits the real availability.
  const clipboardWritable = useCanWriteTextToClipboard();
  const copy = onCopy
    ? createCopyAction(m, onCopy)
    : clipboardWritable
      ? () => writeTextToClipboard(m.text ?? '')
      : undefined;
  const resolvedInitialFeedback = initialFeedback === undefined ? getInitialMessageFeedback(m) : initialFeedback;
  const actions: MessageRenderActions = {
    canEdit: Boolean(m.role === 'user' && onEdit),
    canRegenerate: Boolean(m.role === 'assistant' && onRegenerate),
    canDelete: Boolean(onDelete),
    edit: m.role === 'user' && onEdit ? (newText) => onEdit(m.id, newText) : undefined,
    regenerate: m.role === 'assistant' && onRegenerate ? () => onRegenerate(m.id) : undefined,
    delete: onDelete ? () => onDelete(m.id) : undefined,
    copy,
    feedback: onFeedback ? (variant) => onFeedback(m, variant) : undefined,
    initialFeedback: resolvedInitialFeedback,
    defaultRender: () => null,
  };

  return (
    <div className={`chorus-msg chorus-${m.role}`} data-chorus-message-id={m.id}>
      <MessageSpeakerLabel role={m.role} speakers={speakerLabels} />
      {editing && actions.edit ? (
        <InlineMessageEditor
          initialText={m.text ?? ''}
          onSubmit={(newText) => {
            actions.edit?.(newText);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          labels={messageActionLabels}
        />
      ) : (
        <MessageBubbleLayout
          message={m}
          codeTheme={codeTheme}
          headless={headless}
          streaming={streaming}
          markdownProps={markdownProps}
          markdownSanitizer={markdownSanitizer}
          reasoningLabel={reasoningLabel}
          codeCopyLabels={codeCopyLabels}
          attachmentLabels={attachmentLabels}
          showTimestamp={showTimestamp}
          formatTimestamp={formatTimestamp}
          before={before}
          headerSlot={headerSlot}
          footerSlot={footerSlot}
          after={after}
        >
          <MessageActions actions={actions} onEditRequested={() => setEditing(true)} labels={messageActionLabels} editButtonRef={editButtonRef} />
        </MessageBubbleLayout>
      )}
    </div>
  );
}
