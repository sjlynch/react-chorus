import React from 'react';
import type { Message } from '../../types';
import type { ChorusAttachmentLabels, ChorusCodeCopyLabels, ChorusSourceLabels, ChorusSpeakerLabels, ChorusToolCallLabels } from '../../labels/types';
import { ARTIFACT_TOOL_NAME } from '../../reservedIds';
import { isArtifactPayload } from '../../artifacts/extractArtifacts';
import { joinClasses } from '../../utils/className';
import { Markdown, type MarkdownSanitizer } from '../Markdown';
import { ToolCallBlock } from '../ToolCallBlock';
import { ToolApprovalCard } from './ToolApprovalCard';
import { ArtifactCard } from './ArtifactCard';
import { BlockRenderer } from '../../blocks/BlockRenderer';
import { ToolLoaderSlot } from '../../blocks/ToolLoader';
import { MessageAttachments } from './attachments';
import { MessageReasoning } from './reasoning';
import { MessageSources } from './sources';
import { MessageTimestamp } from './timestamp';
import { MessageRenderStateContext } from './renderState';
import { MessageSpeakerLabel } from './speaker';
import type { MessageBubbleSlots, MessageMarkdownProps, MessageTimestampFormatter } from './types';

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
  /** Label overrides for source/citation lists rendered on messages. */
  sourceLabels?: ChorusSourceLabels;
  /** Label overrides for the tool-call block rendered for `role: 'tool'` messages. */
  toolCallLabels?: Partial<ChorusToolCallLabels>;
  /** Render the message's `createdAt` time below the bubble. Off by default. */
  showTimestamp?: boolean;
  /** Override the locale-aware default timestamp formatting. Only used when `showTimestamp` is true. */
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
  children?: React.ReactNode;
}

export function MessageBubbleLayout<TMeta = Record<string, unknown>>({ message, codeTheme, headless, streaming = false, markdownProps, markdownSanitizer, reasoningLabel, codeCopyLabels, attachmentLabels, sourceLabels, toolCallLabels, showTimestamp = false, formatTimestamp, before, headerSlot, footerSlot, after, children }: MessageBubbleLayoutProps<TMeta>) {
  const text = message.text ?? '';
  const hasAttachments = Boolean(message.attachments?.length);
  const hasBubbleText = text.trim().length > 0;
  const hasBlock = Boolean(message.block);
  const shouldRenderBubble = (hasBubbleText || hasAttachments) && !hasBlock;
  // A block-bearing tool message stands in for the tool row: the registered
  // block renders inline, the standard ToolCallBlock chrome is suppressed,
  // and per-tool loaders are skipped (the block itself is the visible state).
  const isBlockToolMessage = message.role === 'tool' && hasBlock;
  // Per-tool loaders surface a "thinking" affordance for a streaming tool
  // whose output has not arrived yet. They never render for block-bearing
  // tool rows (the block itself is the visible state). The slot itself
  // checks `streaming` and the session-level `sending` flag so a tool-only
  // turn (no assistant message id) still shows the loader.
  const showToolLoader = message.role === 'tool' && !hasBlock;

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
        {hasBlock && message.block && (
          // Generative-UI block: registered via <Chorus blocks={...}>. The
          // assistant emits this through a `__render_block` tool call;
          // `toolExecution.buildToolMessageFromDelta` maps the parsed
          // `{ name, props }` onto `message.block` so the renderer can stand
          // in for the normal tool-call chrome.
          <BlockRenderer block={message.block} />
        )}
        {message.role === 'tool' && !isBlockToolMessage && (() => {
          // `__artifact` reserved tool calls render as an artifact card linking
          // to the side panel instead of the raw tool-call block. The card's
          // version is looked up by `messageId` against the artifact context so
          // follow-up emissions surface as `v2`, `v3`, … on the same row.
          if (message.toolCall.name === ARTIFACT_TOOL_NAME && isArtifactPayload(message.toolCall.input)) {
            const payload = message.toolCall.input;
            return (
              <ArtifactCard
                id={payload.id}
                kind={payload.kind}
                title={payload.title}
                messageId={message.id}
              />
            );
          }
          // Render the tool call here, not only in ChatWindow's tool branch, so
          // a host composing a custom shell with the exported MessageRow /
          // MessageBubble gets the structured call instead of an empty bubble
          // (or nothing, since `shouldRenderBubble` is false for an empty-text
          // tool message). `message.text`, when present, renders above as a
          // host-authored summary. When an approval is pending, the approval
          // card replaces the tool block — the structured call is shown again
          // once the gate resolves.
          if (message.toolCall?.approval === 'pending') {
            return <ToolApprovalCard toolCall={message.toolCall} />;
          }
          return <ToolCallBlock toolCall={message.toolCall} labels={toolCallLabels} streaming={streaming} />;
        })()}
        {showToolLoader && message.role === 'tool' && (
          <ToolLoaderSlot toolCall={message.toolCall} streaming={streaming} />
        )}
        <MessageSources sources={message.sources} labels={sourceLabels} />
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
  /** Label overrides for source/citation lists rendered on messages. */
  sourceLabels?: ChorusSourceLabels;
  /** Label overrides for the tool-call block rendered for `role: 'tool'` messages. */
  toolCallLabels?: Partial<ChorusToolCallLabels>;
  /** Render the message's `createdAt` time below the bubble. Off by default. */
  showTimestamp?: boolean;
  /** Override the locale-aware default timestamp formatting. Only used when `showTimestamp` is true. */
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
}

export function MessageBubble<TMeta = Record<string, unknown>>({ message, className, style, codeTheme = 'dark', headless, streaming = false, markdownProps, markdownSanitizer, reasoningLabel, codeCopyLabels, speakerLabels, attachmentLabels, sourceLabels, toolCallLabels, showTimestamp, formatTimestamp, before, headerSlot, footerSlot, after }: MessageBubbleProps<TMeta>) {
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
        sourceLabels={sourceLabels}
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
