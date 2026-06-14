import type { Message, MessageFeedback } from '../types';
import type { ChorusApprovalLabels, ChorusArtifactLabels, ChorusAttachmentLabels, ChorusCodeCopyLabels, ChorusMessageActionLabels, ChorusSourceLabels, ChorusSpeakerLabels, ChorusToolCallLabels } from '../labels/types';
import { formatMessageForClipboard } from '../hooks/transcriptFormatters';
import { useCanWriteTextToClipboard, writeTextToClipboard } from '../utils/messageCopy';
import type { MarkdownSanitizer } from './Markdown';
import { MessageActions, createCopyAction } from './message-row/actions';
import { MessageBubbleLayout } from './message-row/bubble';
import { getInitialMessageFeedback } from './message-row/feedback';
import { InlineMessageEditor } from './message-row/InlineMessageEditor';
import { useActionEditing, useReturnFocusAfterEditing } from './message-row/renderState';
import { MessageSpeakerLabel } from './message-row/speaker';
import type { MessageBubbleSlots, MessageCopyResult, MessageMarkdownProps, MessageRenderActions, MessageTimestampFormatter } from './message-row/types';

export type { MessageFeedback } from '../types';
export { MessageActionControls, MessageActions, actionButtonClass, createCopyAction } from './message-row/actions';
export type { MessageActionsProps } from './message-row/actions';
export { MessageAttachments } from './message-row/attachments';
export { MessageBubble, MessageBubbleLayout } from './message-row/bubble';
export type { MessageBubbleLayoutProps, MessageBubbleProps } from './message-row/bubble';
export { MessageReasoning } from './message-row/reasoning';
export type { MessageReasoningProps } from './message-row/reasoning';
export { MessageSources } from './message-row/sources';
export type { MessageSourcesProps } from './message-row/sources';
export { MessageTimestamp } from './message-row/timestamp';
export type { MessageTimestampProps } from './message-row/timestamp';
export { getInitialMessageFeedback, getMetadataFeedback, isMessageFeedback } from './message-row/feedback';
export type { GetMessageFeedback } from './message-row/feedback';
export { InlineMessageEditor } from './message-row/InlineMessageEditor';
export type { InlineMessageEditorProps } from './message-row/InlineMessageEditor';
export { MessageRenderStateContext, MessageRenderStateProvider, useActionEditing } from './message-row/renderState';
export type { MessageRenderStateValue } from './message-row/renderState';
export { getMessageSpeakerLabel, MessageSpeakerBadge, MessageSpeakerLabel, resolveMessageSpeakerLabel } from './message-row/speaker';
export type { MessageSpeakerBadgeProps, MessageSpeakerLabelProps } from './message-row/speaker';
export { defaultFormatMessageTimestamp } from './message-row/formatTimestamp';
export type { MessageBubbleSlots, MessageCopyResult, MessageMarkdownProps, MessageRenderActions, MessageTimestampFormatter } from './message-row/types';

export interface MessageRowProps<TMeta = Record<string, unknown>> extends MessageBubbleSlots {
  m: Message<TMeta>;
  codeTheme: 'dark' | 'light';
  headless?: boolean;
  /**
   * Called when a message edit is saved. `newText` is always a non-empty trimmed
   * string — the inline editor trims input and cancels (without calling this) when
   * the result is empty.
   */
  onEdit?: (id: string, newText: string) => void;
  onRegenerate?: (id: string) => void;
  onDelete?: (id: string) => void;
  /**
   * Overrides the built-in message copy action. Return false (or Promise<false>)
   * to show the Copy failed indicator; return void to keep historical assume-success behavior.
   */
  onCopy?: (message: Message<TMeta>) => MessageCopyResult;
  /** Called when feedback changes. Receives `null` when the active thumb is clicked again to clear the rating. */
  onFeedback?: (message: Message<TMeta>, feedback: MessageFeedback | null) => void;
  /** Seeds the pressed thumb state. When omitted, message.metadata.feedback is used if it is 'up' or 'down'. */
  initialFeedback?: MessageFeedback | null;
  /** Renders `initialFeedback` as an inert thumb when no `onFeedback` handler is wired. */
  feedbackReadOnly?: boolean;
  streaming?: boolean;
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
  messageActionLabels?: ChorusMessageActionLabels;
  speakerLabels?: ChorusSpeakerLabels;
  reasoningLabel?: string;
  codeCopyLabels?: ChorusCodeCopyLabels;
  attachmentLabels?: ChorusAttachmentLabels;
  /** Label overrides for source/citation lists rendered on messages. */
  sourceLabels?: ChorusSourceLabels;
  /** Label overrides for the tool-call block rendered for `role: 'tool'` messages. */
  toolCallLabels?: Partial<ChorusToolCallLabels>;
  /** Label overrides for inline artifact cards rendered for `__artifact` tool messages. */
  artifactLabels?: Partial<ChorusArtifactLabels>;
  /** Label overrides for the pending tool-approval card. */
  approvalLabels?: Partial<ChorusApprovalLabels>;
  /** Render the message's `createdAt` time below the bubble. Off by default. */
  showTimestamp?: boolean;
  /** Override the locale-aware default timestamp formatting. Only used when `showTimestamp` is true. */
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
  /**
   * Render `message.speaker.avatarUrl` as a small circular avatar next to the
   * speaker name. The speaker name renders unconditionally when
   * `message.speaker` is present; only the avatar image is gated.
   */
  showSpeakerAvatars?: boolean;
}

export function MessageRow<TMeta = Record<string, unknown>>({ m, codeTheme, headless, onEdit, onRegenerate, onDelete, onCopy, onFeedback, initialFeedback, feedbackReadOnly, streaming = false, markdownProps, markdownSanitizer, messageActionLabels, speakerLabels, reasoningLabel, codeCopyLabels, attachmentLabels, sourceLabels, toolCallLabels, artifactLabels, approvalLabels, showTimestamp, formatTimestamp, showSpeakerAvatars, before, headerSlot, footerSlot, after }: MessageRowProps<TMeta>) {
  // Drive editing state through MessageRenderStateContext when a provider is present
  // (the default ChatWindow path wraps every row in one) so a custom renderer's
  // `ctx.isEditing` reflects the row's inline editor. Falls back to local state when
  // MessageRow is used standalone without a provider.
  const [editing, setEditing] = useActionEditing(m.id);
  const editButtonRef = useReturnFocusAfterEditing<HTMLButtonElement>(editing);
  // Defer the navigator.clipboard fallback so the SSR tree (no clipboard)
  // matches the initial client tree. The button appears after the mount
  // effect commits the real availability.
  const clipboardWritable = useCanWriteTextToClipboard();
  const copy = onCopy
    ? createCopyAction(m, onCopy)
    : clipboardWritable
      ? () => writeTextToClipboard(formatMessageForClipboard(m))
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
    feedbackReadOnly,
    defaultRender: () => null,
  };

  return (
    <div className={`chorus-msg chorus-${m.role}`} data-chorus-message-id={m.id}>
      <MessageSpeakerLabel role={m.role} speakers={speakerLabels} speaker={m.speaker} />
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
          sourceLabels={sourceLabels}
          toolCallLabels={toolCallLabels}
          artifactLabels={artifactLabels}
          approvalLabels={approvalLabels}
          showTimestamp={showTimestamp}
          formatTimestamp={formatTimestamp}
          showSpeakerAvatars={showSpeakerAvatars}
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
