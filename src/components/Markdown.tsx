import React from 'react';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import DOMPurify from 'dompurify';
import { getHljs, highlightCode, isHljsLoaded, loadHljsTheme, type CodeTheme } from '../utils/hljsLoader';
import { normalizeStreamingMarkdown } from '../utils/markdownNormalizer';

export { normalizeStreamingMarkdown };

const COPY_FEEDBACK_DURATION_MS = 1200;

const markedInstance = new Marked({ gfm: true, breaks: true });
markedInstance.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight: highlightCode,
}));

export type MarkdownSanitizer = ((html: string) => string) | { sanitize: (html: string) => string };

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
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fallbackSanitizeHtml(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<\/?(?:script|style|iframe|object|embed|link|meta|base|template)[^>]*>/gi, '')
    .replace(/\s+on[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/gi, '')
    .replace(/\s+(?:srcdoc|style)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/gi, '')
    .replace(/\s+(?:href|src|xlink:href|formaction)\s*=\s*(?:"\s*(?:javascript|vbscript):[^"]*"|'\s*(?:javascript|vbscript):[^']*'|(?:javascript|vbscript):[^\s"'=<>`]+)/gi, '');
}

function resolveSanitizer(sanitizer?: MarkdownSanitizer) {
  if (typeof sanitizer === 'function') return sanitizer;
  if (sanitizer && typeof sanitizer.sanitize === 'function') return sanitizer.sanitize.bind(sanitizer);

  const domPurify = DOMPurify as unknown as { sanitize?: (html: string) => string };
  if (domPurify && typeof domPurify.sanitize === 'function') return domPurify.sanitize.bind(domPurify);

  return fallbackSanitizeHtml;
}

function renderMarkdown(text: string, sanitizer?: MarkdownSanitizer) {
  const balanced = normalizeStreamingMarkdown(text);

  let raw: string;
  try {
    raw = markedInstance.parse(balanced) as string;
  } catch {
    raw = `<pre><code>${escapeHtml(balanced)}</code></pre>`;
  }

  return resolveSanitizer(sanitizer)(raw);
}

function addCodeBlockChrome(html: string, codeTheme: CodeTheme) {
  const themeClass = codeTheme === 'light' ? 'chorus-codeblock-light' : 'chorus-codeblock-dark';
  return html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (_match, attrs: string, code: string) => (
    `<div class="chorus-codeblock ${themeClass}">` +
      '<span class="chorus-copy-btn" role="button" aria-label="Copy code" tabindex="0">Copy</span>' +
      `<pre><code${attrs}>${code}</code></pre>` +
    '</div>'
  ));
}

export function Markdown({ text, codeTheme = 'dark', headless = false, streaming = false, sanitizer }: MarkdownProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [hljsReady, setHljsReady] = React.useState(isHljsLoaded());

  React.useEffect(() => {
    if (streaming) return;
    if (!text.includes('```') && !text.includes('~~~')) return;
    if (!headless) loadHljsTheme(codeTheme);
    if (!hljsReady) getHljs().then(() => setHljsReady(true));
  }, [text, codeTheme, headless, hljsReady, streaming]);

  React.useEffect(() => {
    if (headless) return;
    if (typeof document === 'undefined') return;
    if (document.getElementById('chorus-md-styles')) return;
    const style = document.createElement('style');
    style.id = 'chorus-md-styles';
    style.textContent =
      `.chorus-md.chorus-md-streaming{white-space:pre-wrap}
       .chorus-md .chorus-codeblock{position:relative;margin:8px 0;border-radius:8px;overflow:auto;border:1px solid var(--chorus-code-border,#30363d)}
       .chorus-md .chorus-codeblock pre{margin:0;padding:12px 16px;background:transparent}
       .chorus-md .chorus-codeblock pre code.hljs{display:block;overflow-x:auto;padding:0;background:transparent}
       .chorus-md .chorus-codeblock-dark{background:#0d1117;--chorus-code-border:#30363d;color:#e6edf3}
       .chorus-md .chorus-codeblock-light{background:#f6f8fa;--chorus-code-border:#d0d7de;color:#24292f}
       .chorus-md .chorus-copy-btn{position:absolute;top:8px;right:8px;font-size:12px;padding:4px 8px;border-radius:6px;cursor:pointer;user-select:none}
       .chorus-md .chorus-codeblock-dark .chorus-copy-btn{background:rgba(240,246,252,0.08);border:1px solid rgba(240,246,252,0.1);color:#e6edf3}
       .chorus-md .chorus-codeblock-light .chorus-copy-btn{background:#fff;border:1px solid rgba(31,35,40,0.15);color:#24292f}
       .chorus-md .chorus-copy-btn.copied{opacity:.85}`;
    document.head.appendChild(style);
  }, [headless]);

  const html = React.useMemo(() => {
    if (streaming) return '';
    void hljsReady;

    const sanitized = renderMarkdown(text, sanitizer);
    if (headless) return sanitized;

    return addCodeBlockChrome(sanitized, codeTheme);
  }, [text, codeTheme, headless, hljsReady, streaming, sanitizer]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === 'undefined' || typeof document === 'undefined' || typeof navigator === 'undefined' || !navigator?.clipboard) return;

    const handleCopy = async (btn: HTMLElement) => {
      const wrapper = btn.closest('.chorus-codeblock') as HTMLElement | null;
      const codeEl = wrapper?.querySelector('pre > code') as HTMLElement | null;
      const raw = codeEl?.innerText ?? '';
      try {
        await navigator.clipboard.writeText(raw);
        const prev = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = prev || 'Copy'; btn.classList.remove('copied'); }, COPY_FEEDBACK_DURATION_MS);
      } catch {}
    };

    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement)?.closest?.('.chorus-copy-btn') as HTMLElement | null;
      if (btn) handleCopy(btn);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const btn = (e.target as HTMLElement)?.closest?.('.chorus-copy-btn') as HTMLElement | null;
      if (!btn) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCopy(btn); }
    };

    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKeyDown);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKeyDown); };
  }, []);

  const className = streaming ? 'chorus-md chorus-md-streaming' : 'chorus-md';
  if (streaming) return <div ref={containerRef} className={className}>{text}</div>;

  return <div ref={containerRef} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
