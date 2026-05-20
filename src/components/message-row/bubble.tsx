import React from 'react';
import type { Attachment, Message } from '../../types';
import { DEFAULT_ATTACHMENT_LABELS } from '../../labels/attachments';
import { DEFAULT_REASONING_LABEL } from '../../labels/reasoning';
import type { ChorusAttachmentLabels, ChorusCodeCopyLabels, ChorusSpeakerLabels } from '../../labels/types';
import { getAttachmentPreviewSource } from '../../utils/attachmentPreview';
import { Markdown, type MarkdownSanitizer } from '../Markdown';
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
}

export function MessageReasoning({ reasoning, codeTheme, headless, streaming = false, markdownProps, markdownSanitizer, reasoningLabel = DEFAULT_REASONING_LABEL, codeCopyLabels }: MessageReasoningProps) {
  if (!reasoning) return null;

  return (
    <details className="chorus-reasoning">
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
  /** Render the message's `createdAt` time below the bubble. Off by default. */
  showTimestamp?: boolean;
  /** Override the locale-aware default timestamp formatting. Only used when `showTimestamp` is true. */
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
  children?: React.ReactNode;
}

export function MessageBubbleLayout<TMeta = Record<string, unknown>>({ message, codeTheme, headless, streaming = false, markdownProps, markdownSanitizer, reasoningLabel, codeCopyLabels, attachmentLabels, showTimestamp = false, formatTimestamp, before, headerSlot, footerSlot, after, children }: MessageBubbleLayoutProps<TMeta>) {
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
          <MessageReasoning reasoning={message.reasoning} codeTheme={codeTheme} headless={headless} streaming={streaming} markdownProps={markdownProps} markdownSanitizer={markdownSanitizer} reasoningLabel={reasoningLabel} codeCopyLabels={codeCopyLabels} />
        )}
        {shouldRenderBubble && (
          <div className="chorus-bubble">
            <MessageAttachments attachments={message.attachments} attachmentLabels={attachmentLabels} />
            {hasBubbleText && <Markdown {...markdownProps} text={text} codeTheme={codeTheme} headless={headless} streaming={streaming} sanitizer={markdownSanitizer ?? markdownProps?.sanitizer} codeCopyLabels={codeCopyLabels ?? markdownProps?.codeCopyLabels} />}
          </div>
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
  /** Render the message's `createdAt` time below the bubble. Off by default. */
  showTimestamp?: boolean;
  /** Override the locale-aware default timestamp formatting. Only used when `showTimestamp` is true. */
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
}

export function MessageBubble<TMeta = Record<string, unknown>>({ message, className, style, codeTheme = 'dark', headless, streaming = false, markdownProps, markdownSanitizer, reasoningLabel, codeCopyLabels, speakerLabels, attachmentLabels, showTimestamp, formatTimestamp, before, headerSlot, footerSlot, after }: MessageBubbleProps<TMeta>) {
  const renderState = React.useContext(MessageRenderStateContext);
  if (renderState?.messageId === message.id && renderState.isEditing) return null;

  const cls = ['chorus-msg', `chorus-${message.role}`, className].filter(Boolean).join(' ');
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
