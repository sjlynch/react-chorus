import React from 'react';
import type { Attachment, Message } from '../../types';
import { DEFAULT_ATTACHMENT_LABELS } from '../../labels/attachments';
import { DEFAULT_REASONING_LABEL } from '../../labels/reasoning';
import type { ChorusAttachmentLabels, ChorusCodeCopyLabels, ChorusSpeakerLabels, ChorusToolCallLabels } from '../../labels/types';
import { getAttachmentPreviewSource } from '../../utils/attachmentPreview';
import { joinClasses } from '../../utils/className';
import { Markdown, type MarkdownSanitizer } from '../Markdown';
import { ToolCallBlock } from '../ToolCallBlock';
import { defaultFormatMessageTimestamp } from './formatTimestamp';
import { MessageRenderStateContext } from './renderState';
import { MessageSpeakerLabel } from './speaker';
import type { MessageBubbleSlots, MessageMarkdownProps, MessageTimestampFormatter } from './types';

export function resolveAttachmentImageAlt(att: Attachment, labels: ChorusAttachmentLabels = DEFAULT_ATTACHMENT_LABELS): string {
  if (typeof att.alt === 'string' && att.alt.length > 0) return att.alt;
  return labels.imageFallbackAlt(att.name);
}

export function MessageAttachments({ attachments, attachmentLabels = DEFAULT_ATTACHMENT_LABELS }: { attachments?: Attachment[]; attachmentLabels?: ChorusAttachmentLabels }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="chorus-msg-attachments">
      {attachments.map((att, i) => {
        const previewSource = getAttachmentPreviewSource(att);
        return att.type.startsWith('image/') && previewSource
          ? <img key={i} src={previewSource} alt={resolveAttachmentImageAlt(att, attachmentLabels)} className="chorus-msg-img" loading="lazy" decoding="async" />
          : <span key={i} className="chorus-msg-file">{att.name}</span>;
      })}
    </div>
  );
}

export interface MessageReasoningProps {
  reasoning?: string;
  codeTheme: 'dark' | 'light';
  headless?: boolean;
  streaming?: boolean;
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
  reasoningLabel?: string;
  codeCopyLabels?: ChorusCodeCopyLabels;
  /**
   * Suggests the reasoning `<details>` should start open. When omitted the
   * disclosure is collapsed by default. The default transcript passes `true`
   * for a reasoning-only streaming turn so a chain-of-thought model's output is
   * visible as it arrives instead of looking frozen behind a collapsed summary
   * with an empty bubble. This is only a starting suggestion: once the reader
   * toggles the disclosure their choice sticks, even as further chunks stream.
   * The hint is also *latched* — once it has been `true` the disclosure stays
   * open after the hint clears (which happens the instant answer text arrives),
   * so the chain-of-thought a reader is following does not collapse out from
   * under them; only an explicit reader collapse closes it again.
   */
  open?: boolean;
}

export function MessageReasoning({ reasoning, codeTheme, headless, streaming = false, markdownProps, markdownSanitizer, reasoningLabel = DEFAULT_REASONING_LABEL, codeCopyLabels, open: openHint }: MessageReasoningProps) {
  // Track the reader's own collapse/expand separately from `openHint` (the
  // transcript's "should be open" suggestion for a reasoning-only streaming
  // turn). A controlled `open={true}` would re-force the disclosure back open
  // on every streamed chunk, so a reader who collapsed the chain-of-thought
  // mid-stream could not keep it collapsed. Once the reader has toggled it,
  // their choice wins over `openHint` until the component unmounts.
  const [readerOpen, setReaderOpen] = React.useState<boolean | null>(null);

  // Latch the open hint. `openHint` is only `true` while reasoning is the sole
  // thing streaming; it flips to `undefined` the instant the first answer
  // token arrives. Reading off `openHint` directly would collapse the panel
  // out from under a reader still following the chain-of-thought. So once the
  // hint has been `true` we keep the disclosure open until the reader collapses
  // it themselves (which records `readerOpen` and overrides the latch).
  const hintLatchedOpen = React.useRef(false);
  if (openHint) hintLatchedOpen.current = true;

  if (!reasoning) return null;

  const open = readerOpen ?? hintLatchedOpen.current;

  return (
    <details
      className="chorus-reasoning"
      open={open}
      onToggle={(event) => setReaderOpen(event.currentTarget.open)}
    >
      <summary className="chorus-reasoning-summary">{reasoningLabel}</summary>
      <div className="chorus-reasoning-body">
        <Markdown {...markdownProps} text={reasoning} codeTheme={codeTheme} headless={headless} streaming={streaming} sanitizer={markdownSanitizer ?? markdownProps?.sanitizer} codeCopyLabels={codeCopyLabels ?? markdownProps?.codeCopyLabels} />
      </div>
    </details>
  );
}

export interface MessageTimestampProps<TMeta = Record<string, unknown>> {
  message: Message<TMeta>;
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
}

/**
 * Renders a message's `createdAt` time as a `<time>` element. Returns null when the
 * message has no `createdAt`, so callers can mount it unconditionally behind a
 * `showTimestamps` flag without first checking for the field.
 */
export function MessageTimestamp<TMeta = Record<string, unknown>>({ message, formatTimestamp }: MessageTimestampProps<TMeta>) {
  const createdAt = message.createdAt;
  if (typeof createdAt !== 'string' || createdAt.length === 0) return null;

  const format = formatTimestamp ?? defaultFormatMessageTimestamp;
  return <time className="chorus-msg-time" dateTime={createdAt}>{format(createdAt, message)}</time>;
}

export interface MessageBubbleLayoutProps<TMeta = Record<string, unknown>> extends MessageBubbleSlots {
  message: Message<TMeta>;
  codeTheme: 'dark' | 'light';
  headless?: boolean;
  streaming?: boolean;
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
  reasoningLabel?: string;
  codeCopyLabels?: ChorusCodeCopyLabels;
  attachmentLabels?: ChorusAttachmentLabels;
  /** Label overrides for the tool-call block rendered for `role: 'tool'` messages. */
  toolCallLabels?: Partial<ChorusToolCallLabels>;
  /** Render the message's `createdAt` time below the bubble. Off by default. */
  showTimestamp?: boolean;
  /** Override the locale-aware default timestamp formatting. Only used when `showTimestamp` is true. */
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
  children?: React.ReactNode;
}

export function MessageBubbleLayout<TMeta = Record<string, unknown>>({ message, codeTheme, headless, streaming = false, markdownProps, markdownSanitizer, reasoningLabel, codeCopyLabels, attachmentLabels, toolCallLabels, showTimestamp = false, formatTimestamp, before, headerSlot, footerSlot, after, children }: MessageBubbleLayoutProps<TMeta>) {
  const text = message.text ?? '';
  const hasAttachments = Boolean(message.attachments?.length);
  const hasBubbleText = text.trim().length > 0;
  const shouldRenderBubble = hasBubbleText || hasAttachments;

  return (
    <>
      {before}
      <div className="chorus-msg-content">
        {headerSlot}
        {message.role === 'assistant' && (
          <MessageReasoning
            reasoning={message.reasoning}
            codeTheme={codeTheme}
            headless={headless}
            streaming={streaming}
            markdownProps={markdownProps}
            markdownSanitizer={markdownSanitizer}
            reasoningLabel={reasoningLabel}
            codeCopyLabels={codeCopyLabels}
            // Reveal the reasoning while it is the only thing streaming: a
            // reasoning-first model emits chain-of-thought before any answer
            // text, so a collapsed summary over an empty bubble looks frozen.
            // This hint clears once answer text arrives, but `MessageReasoning`
            // latches it — an auto-opened panel stays open through the answer
            // so a reader mid-thought is not collapsed out from under them.
            open={streaming && !hasBubbleText ? true : undefined}
          />
        )}
        {shouldRenderBubble && (
          <div className="chorus-bubble">
            <MessageAttachments attachments={message.attachments} attachmentLabels={attachmentLabels} />
            {hasBubbleText && <Markdown {...markdownProps} text={text} codeTheme={codeTheme} headless={headless} streaming={streaming} sanitizer={markdownSanitizer ?? markdownProps?.sanitizer} codeCopyLabels={codeCopyLabels ?? markdownProps?.codeCopyLabels} />}
          </div>
        )}
        {message.role === 'tool' && (
          // Render the tool call here, not only in ChatWindow's tool branch, so
          // a host composing a custom shell with the exported MessageRow /
          // MessageBubble gets the structured call instead of an empty bubble
          // (or nothing, since `shouldRenderBubble` is false for an empty-text
          // tool message). `message.text`, when present, renders above as a
          // host-authored summary.
          <ToolCallBlock toolCall={message.toolCall} labels={toolCallLabels} streaming={streaming} />
        )}
        {showTimestamp && <MessageTimestamp message={message} formatTimestamp={formatTimestamp} />}
        {footerSlot}
        {children}
      </div>
      {after}
    </>
  );
}

export interface MessageBubbleProps<TMeta = Record<string, unknown>> extends MessageBubbleSlots {
  message: Message<TMeta>;
  className?: string;
  style?: React.CSSProperties;
  codeTheme?: 'dark' | 'light';
  headless?: boolean;
  streaming?: boolean;
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
  reasoningLabel?: string;
  codeCopyLabels?: ChorusCodeCopyLabels;
  speakerLabels?: ChorusSpeakerLabels;
  attachmentLabels?: ChorusAttachmentLabels;
  /** Label overrides for the tool-call block rendered for `role: 'tool'` messages. */
  toolCallLabels?: Partial<ChorusToolCallLabels>;
  /** Render the message's `createdAt` time below the bubble. Off by default. */
  showTimestamp?: boolean;
  /** Override the locale-aware default timestamp formatting. Only used when `showTimestamp` is true. */
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
}

export function MessageBubble<TMeta = Record<string, unknown>>({ message, className, style, codeTheme = 'dark', headless, streaming = false, markdownProps, markdownSanitizer, reasoningLabel, codeCopyLabels, speakerLabels, attachmentLabels, toolCallLabels, showTimestamp, formatTimestamp, before, headerSlot, footerSlot, after }: MessageBubbleProps<TMeta>) {
  const renderState = React.useContext(MessageRenderStateContext);
  if (renderState?.messageId === message.id && renderState.isEditing) return null;

  const cls = joinClasses('chorus-msg', `chorus-${message.role}`, className);
  return (
    <div className={cls} style={style} data-chorus-message-id={message.id}>
      <MessageSpeakerLabel role={message.role} speakers={speakerLabels} />
      <MessageBubbleLayout
        message={message}
        codeTheme={codeTheme}
        headless={headless ?? false}
        streaming={streaming}
        markdownProps={markdownProps}
        markdownSanitizer={markdownSanitizer}
        reasoningLabel={reasoningLabel}
        codeCopyLabels={codeCopyLabels}
        attachmentLabels={attachmentLabels}
        toolCallLabels={toolCallLabels}
        showTimestamp={showTimestamp}
        formatTimestamp={formatTimestamp}
        before={before}
        headerSlot={headerSlot}
        footerSlot={footerSlot}
        after={after}
      />
    </div>
  );
}
