import React from 'react';
import type { MarkedExtension, MarkedOptions } from 'marked';
import { DEFAULT_CODE_COPY_LABELS } from '../labels/codeCopy';
import type { ChorusCodeCopyLabels } from '../labels/types';
import { applyChorusStyleNonce } from '../utils/cspNonce';
import { normalizeStreamingMarkdown } from '../utils/markdownNormalizer';
import { addCodeBlockChrome } from './markdown/codeBlockChrome';
import type { CodeBlockCopy, CodeBlockCopyContext, CodeBlockCopyRenderer } from './markdown/codeBlockChrome';
import { useHighlightLoader, type CodeTheme } from './markdown/highlight';
import { resolveMarkedInstance } from './markdown/marked';
import { renderMarkdown } from './markdown/renderMarkdown';
import { resolveSanitizer, type MarkdownSanitizer } from './markdown/sanitize';
import { useCodeCopy } from './markdown/useCodeCopy';

export { normalizeStreamingMarkdown };
export type { MarkdownSanitizer, CodeBlockCopy, CodeBlockCopyContext, CodeBlockCopyRenderer };

export interface MarkdownProps {
  text: string;
  codeTheme?: CodeTheme;
  headless?: boolean;
  /**
   * Render the growing text as escaped plain text instead of reparsing the
   * entire markdown document for every streamed chunk. Chorus sets this for
   * the active assistant message and switches it off when the stream finalizes.
   */
  streaming?: boolean;
  /** Optional sanitizer override, useful for SSR frameworks that provide their own DOMPurify instance. */
  sanitizer?: MarkdownSanitizer;
  /** Optional marked parser options. Passing this creates an isolated Marked instance for this component config. */
  markedOptions?: MarkedOptions;
  /** Optional marked extensions registered on an isolated Marked instance for this component config. */
  markedExtensions?: MarkedExtension[];
  /** Called when a code-block copy button cannot write to the Clipboard API. */
  onCopyError?: (error: Error) => void;
  /** Localized labels for the code-block copy button. */
  codeCopyLabels?: ChorusCodeCopyLabels;
  /**
   * Controls the per-code-block copy chrome.
   * - `'default'` / `true` / omitted: the built-in accessible copy `<button>`.
   * - `false`: opt out — no copy chrome (the styled code-block wrapper remains).
   * - a function `(ctx) => htmlString`: render your own chrome. The returned
   *   HTML is inserted ahead of the `<pre>`; include a `chorus-copy-btn`
   *   element to keep the built-in clipboard wiring. Pass a stable function
   *   reference (define it outside render or memoize it) to avoid reparsing.
   *
   * Ignored in `headless` mode, which never injects code-block chrome.
   */
  codeBlockCopy?: CodeBlockCopy;
}

function useMarkdownStyles(headless: boolean) {
  React.useEffect(() => {
    if (headless) return;
    if (typeof document === 'undefined') return;
    if (document.getElementById('chorus-md-styles')) return;
    const style = document.createElement('style');
    style.id = 'chorus-md-styles';
    applyChorusStyleNonce(style);
    style.textContent =
      `.chorus-md.chorus-md-streaming{white-space:pre-wrap}
       .chorus-md .chorus-codeblock{position:relative;margin:8px 0;border-radius:8px;overflow:auto;border:1px solid var(--chorus-code-border,#30363d)}
       .chorus-md .chorus-codeblock pre{margin:0;padding:12px 16px;background:transparent}
       .chorus-md .chorus-codeblock pre code.hljs{display:block;overflow-x:auto;padding:0;background:transparent}
       .chorus-md .chorus-codeblock-dark{background:#0d1117;--chorus-code-border:#30363d;color:#e6edf3}
       .chorus-md .chorus-codeblock-light{background:#f6f8fa;--chorus-code-border:#d0d7de;color:#24292f}
       .chorus-md .chorus-copy-btn{position:absolute;top:8px;right:8px;margin:0;font:inherit;font-size:12px;line-height:1.4;padding:4px 8px;border-radius:6px;cursor:pointer;user-select:none}
       .chorus-md .chorus-codeblock-dark .chorus-copy-btn{background:rgba(240,246,252,0.08);border:1px solid rgba(240,246,252,0.1);color:#e6edf3}
       .chorus-md .chorus-codeblock-light .chorus-copy-btn{background:#fff;border:1px solid rgba(31,35,40,0.15);color:#24292f}
       .chorus-md .chorus-copy-btn.copied{opacity:.85}
       .chorus-md .chorus-copy-btn.copy-failed{opacity:.95;color:var(--chorus-error-text,#fca5a5);border-color:var(--chorus-error-border,rgba(220,38,38,0.4));background:var(--chorus-error-bg,rgba(220,38,38,0.15))}
       .chorus-md .chorus-copy-status{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}`;
    document.head.appendChild(style);
  }, [headless]);
}

export function Markdown({ text, codeTheme = 'dark', headless = false, streaming = false, sanitizer, markedOptions, markedExtensions, onCopyError, codeCopyLabels, codeBlockCopy = 'default' }: MarkdownProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const sanitize = React.useMemo(() => resolveSanitizer(sanitizer), [sanitizer]);
  const safe = !sanitize;
  const marked = React.useMemo(() => resolveMarkedInstance(safe, markedOptions, markedExtensions), [safe, markedOptions, markedExtensions]);
  const hljsReady = useHighlightLoader({ text, codeTheme, headless, streaming });
  const labels = codeCopyLabels ?? DEFAULT_CODE_COPY_LABELS;

  useMarkdownStyles(headless);

  const html = React.useMemo(() => {
    if (streaming) return '';
    void hljsReady;

    const sanitized = renderMarkdown(text, sanitize, marked);
    if (headless) return sanitized;

    return addCodeBlockChrome(sanitized, codeTheme, labels, codeBlockCopy);
  }, [text, codeTheme, headless, hljsReady, streaming, sanitize, marked, labels, codeBlockCopy]);

  useCodeCopy(containerRef, onCopyError, labels);

  const className = streaming ? 'chorus-md chorus-md-streaming' : 'chorus-md';
  if (streaming) return <div ref={containerRef} className={className}>{text}</div>;

  return <div ref={containerRef} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
