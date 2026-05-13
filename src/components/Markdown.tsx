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

const safeMarkedInstance = new Marked({ gfm: true, breaks: true });
safeMarkedInstance.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight: highlightCode,
}));

export type MarkdownSanitizer = ((html: string) => string) | { sanitize: (html: string) => string };
type SanitizerFn = (html: string) => string;
type DOMPurifyInstance = { sanitize?: SanitizerFn };
type DOMPurifyFactory = ((window: Window) => DOMPurifyInstance) & DOMPurifyInstance;

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

const SAFE_LINK_PROTOCOLS = new Set(['http', 'https', 'mailto', 'tel']);
const SAFE_IMAGE_PROTOCOLS = new Set(['http', 'https']);
const URL_CHARACTER_REFERENCES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['colon', ':'],
  ['Tab', '\t'],
  ['tab', '\t'],
  ['NewLine', '\n'],
  ['newline', '\n'],
]);

let browserDOMPurifySanitizer: SanitizerFn | undefined;

safeMarkedInstance.use({
  renderer: {
    html() {
      return '';
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!isSafeMarkdownUrl(href, SAFE_LINK_PROTOCOLS)) return label;

      return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${label}</a>`;
    },
    image({ href, title, text, tokens }) {
      const alt = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : text;
      if (!isSafeMarkdownUrl(href, SAFE_IMAGE_PROTOCOLS)) return escapeHtml(alt);

      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`;
    },
  },
});

function decodeUrlCharacterReferences(value: string) {
  let output = '';

  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '&') {
      output += value[i];
      continue;
    }

    const semicolon = value.indexOf(';', i + 1);
    if (semicolon === -1 || semicolon - i > 32) {
      output += value[i];
      continue;
    }

    const decoded = decodeCharacterReference(value.slice(i + 1, semicolon));
    if (decoded === undefined) {
      output += value.slice(i, semicolon + 1);
    } else {
      output += decoded;
    }
    i = semicolon;
  }

  return output;
}

function decodeCharacterReference(reference: string) {
  if (reference.startsWith('#x') || reference.startsWith('#X')) return decodeNumericCharacterReference(reference.slice(2), 16);
  if (reference.startsWith('#')) return decodeNumericCharacterReference(reference.slice(1), 10);
  return URL_CHARACTER_REFERENCES.get(reference);
}

function decodeNumericCharacterReference(value: string, radix: 10 | 16) {
  let codePoint = 0;
  if (!value) return undefined;

  for (const char of value) {
    const digit = digitValue(char);
    if (digit === undefined || digit >= radix) return undefined;
    codePoint = codePoint * radix + digit;
  }

  if (codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '\ufffd';
  return String.fromCodePoint(codePoint);
}

function digitValue(char: string) {
  const code = char.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return undefined;
}

function removeAsciiControlAndSpace(value: string) {
  let output = '';

  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) continue;
    output += char;
  }

  return output;
}

function firstUrlDelimiterIndex(value: string) {
  const slash = value.indexOf('/');
  const query = value.indexOf('?');
  const hash = value.indexOf('#');
  let first = -1;

  for (const index of [slash, query, hash]) {
    if (index !== -1 && (first === -1 || index < first)) first = index;
  }

  return first;
}

function isSafeMarkdownUrl(value: string, allowedProtocols: Set<string>) {
  const normalized = removeAsciiControlAndSpace(decodeUrlCharacterReferences(value).trim());
  const colon = normalized.indexOf(':');
  if (colon === -1) return true;

  const firstDelimiter = firstUrlDelimiterIndex(normalized);
  if (firstDelimiter !== -1 && firstDelimiter < colon) return true;

  return allowedProtocols.has(normalized.slice(0, colon).toLowerCase());
}

function parseWithMarked(instance: Marked, text: string) {
  try {
    return instance.parse(text) as string;
  } catch {
    return `<pre><code>${escapeHtml(text)}</code></pre>`;
  }
}

function resolveSanitizer(sanitizer?: MarkdownSanitizer): SanitizerFn | undefined {
  if (typeof sanitizer === 'function') return sanitizer;
  if (sanitizer && typeof sanitizer.sanitize === 'function') return sanitizer.sanitize.bind(sanitizer);

  const domPurify = DOMPurify as unknown as DOMPurifyFactory;
  if (typeof domPurify.sanitize === 'function') return domPurify.sanitize.bind(domPurify);
  if (typeof window !== 'undefined' && typeof domPurify === 'function') {
    if (!browserDOMPurifySanitizer) {
      const instance = domPurify(window);
      if (typeof instance.sanitize === 'function') browserDOMPurifySanitizer = instance.sanitize.bind(instance);
    }
    return browserDOMPurifySanitizer;
  }

  return undefined;
}

function renderMarkdown(text: string, sanitizer?: MarkdownSanitizer) {
  const balanced = normalizeStreamingMarkdown(text);
  const sanitize = resolveSanitizer(sanitizer);

  if (!sanitize) return parseWithMarked(safeMarkedInstance, balanced);
  return sanitize(parseWithMarked(markedInstance, balanced));
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
