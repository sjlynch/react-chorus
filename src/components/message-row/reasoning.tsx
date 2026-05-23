import React from 'react';
import { DEFAULT_REASONING_LABEL } from '../../labels/reasoning';
import type { ChorusCodeCopyLabels } from '../../labels/types';
import { Markdown, type MarkdownSanitizer } from '../Markdown';
import type { MessageMarkdownProps } from './types';

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
