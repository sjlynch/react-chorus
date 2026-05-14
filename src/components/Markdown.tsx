import React from 'react';
import { Marked, type MarkedExtension, type MarkedOptions } from 'marked';
import { markedHighlight } from 'marked-highlight';
import DOMPurify from 'dompurify';
import { getHljs, highlightCode, isHljsLoaded, loadHljsTheme, type CodeTheme } from '../utils/hljsLoader';
import { normalizeStreamingMarkdown } from '../utils/markdownNormalizer';

export { normalizeStreamingMarkdown };

const COPY_FEEDBACK_DURATION_MS = 1200;
const DEFAULT_MARKED_OPTIONS: MarkedOptions = { gfm: true, breaks: true };

function createHighlightExtension() {
  return markedHighlight({
    langPrefix: 'hljs language-',
    highlight: highlightCode,
  });
}

function createMarkedInstance(options?: MarkedOptions) {
  const instance = new Marked();
  instance.setOptions(options ?? { ...DEFAULT_MARKED_OPTIONS });
  instance.use(createHighlightExtension());
  return instance;
}

const markedInstance = createMarkedInstance();
const safeMarkedInstance = createMarkedInstance();

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
  /** Optional marked parser options. Passing this creates an isolated Marked instance for this render. */
  markedOptions?: MarkedOptions;
  /** Optional marked extensions registered on an isolated Marked instance for this render. */
  markedExtensions?: MarkedExtension[];
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

const safeRendererExtension: MarkedExtension = {
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
};

safeMarkedInstance.use(safeRendererExtension);

function hasCustomMarkedConfig(markedOptions?: MarkedOptions, markedExtensions?: MarkedExtension[]) {
  return markedOptions !== undefined || (markedExtensions?.length ?? 0) > 0;
}

function createConfiguredMarkedInstance(markedOptions: MarkedOptions | undefined, markedExtensions: MarkedExtension[] | undefined, safe: boolean) {
  const instance = createMarkedInstance(markedOptions);
  if (markedExtensions?.length) instance.use(...markedExtensions);
  if (safe) instance.use(safeRendererExtension);
  return instance;
}

function resolveMarkedInstance(safe: boolean, markedOptions?: MarkedOptions, markedExtensions?: MarkedExtension[]) {
  if (!hasCustomMarkedConfig(markedOptions, markedExtensions)) return safe ? safeMarkedInstance : markedInstance;
  return createConfiguredMarkedInstance(markedOptions, markedExtensions, safe);
}

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

function renderMarkdown(text: string, sanitizer?: MarkdownSanitizer, markedOptions?: MarkedOptions, markedExtensions?: MarkedExtension[]) {
  const balanced = normalizeStreamingMarkdown(text);
  const sanitize = resolveSanitizer(sanitizer);
  const instance = resolveMarkedInstance(!sanitize, markedOptions, markedExtensions);
  const parsed = parseWithMarked(instance, balanced);

  if (!sanitize) return parsed;
  return sanitize(parsed);
}

const VOID_HTML_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

interface HtmlTagMatch {
  start: number;
  end: number;
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

function copyButtonHtml() {
  return '<span class="chorus-copy-btn" role="button" aria-label="Copy code" tabindex="0">Copy</span>';
}

function codeBlockWrapperStart(themeClass: string) {
  return `<div class="chorus-codeblock ${themeClass}">${copyButtonHtml()}`;
}

function addCodeBlockChromeWithDOM(html: string, themeClass: string) {
  if (typeof DOMParser === 'undefined') return undefined;

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const codeBlocks = Array.from(doc.querySelectorAll('pre > code'));

    for (const code of codeBlocks) {
      const pre = code.parentElement;
      if (!pre || pre.parentElement?.classList.contains('chorus-codeblock')) continue;

      const wrapper = doc.createElement('div');
      wrapper.className = `chorus-codeblock ${themeClass}`;
      const copyButton = doc.createElement('span');
      copyButton.className = 'chorus-copy-btn';
      copyButton.setAttribute('role', 'button');
      copyButton.setAttribute('aria-label', 'Copy code');
      copyButton.setAttribute('tabindex', '0');
      copyButton.textContent = 'Copy';

      pre.parentNode?.insertBefore(wrapper, pre);
      wrapper.append(copyButton, pre);
    }

    return doc.body.innerHTML;
  } catch {
    return undefined;
  }
}

function isHtmlNameChar(char: string | undefined) {
  return !!char && /[A-Za-z0-9:-]/.test(char);
}

function isAsciiWhitespace(char: string | undefined) {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f';
}

function findHtmlTagEnd(html: string, start: number) {
  let quote: '"' | "'" | null = null;

  for (let i = start + 1; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }

  return -1;
}

function readHtmlTag(html: string, start: number): HtmlTagMatch | null {
  if (html[start] !== '<') return null;

  const end = findHtmlTagEnd(html, start);
  if (end === -1) return null;

  let cursor = start + 1;
  const marker = html[cursor];
  if (marker === '!' || marker === '?') return { start, end, name: '', closing: false, selfClosing: true };

  let closing = false;
  if (marker === '/') {
    closing = true;
    cursor += 1;
  }

  while (isAsciiWhitespace(html[cursor])) cursor += 1;
  const nameStart = cursor;
  while (isHtmlNameChar(html[cursor])) cursor += 1;
  if (cursor === nameStart) return { start, end, name: '', closing, selfClosing: true };

  let beforeEnd = end - 1;
  while (isAsciiWhitespace(html[beforeEnd])) beforeEnd -= 1;

  return {
    start,
    end,
    name: html.slice(nameStart, cursor).toLowerCase(),
    closing,
    selfClosing: !closing && html[beforeEnd] === '/',
  };
}

function findNextHtmlTag(html: string, from: number): HtmlTagMatch | null {
  let start = html.indexOf('<', from);

  while (start !== -1) {
    const tag = readHtmlTag(html, start);
    if (tag) return tag;
    start = html.indexOf('<', start + 1);
  }

  return null;
}

function findMatchingCloseTag(html: string, tagName: string, from: number) {
  let depth = 1;
  let cursor = from;

  while (cursor < html.length) {
    const tag = findNextHtmlTag(html, cursor);
    if (!tag) return null;
    cursor = tag.end + 1;
    if (tag.name !== tagName) continue;

    if (tag.closing) {
      depth -= 1;
      if (depth === 0) return tag;
    } else if (!tag.selfClosing && !VOID_HTML_ELEMENTS.has(tag.name)) {
      depth += 1;
    }
  }

  return null;
}

function hasDirectCodeChild(html: string, from: number, to: number) {
  let depth = 0;
  let cursor = from;

  while (cursor < to) {
    const tag = findNextHtmlTag(html, cursor);
    if (!tag || tag.start >= to || tag.end >= to) return false;
    cursor = tag.end + 1;

    if (!tag.name) continue;
    if (tag.name === 'code' && !tag.closing && depth === 0) return true;

    if (tag.closing) depth = Math.max(0, depth - 1);
    else if (!tag.selfClosing && !VOID_HTML_ELEMENTS.has(tag.name)) depth += 1;
  }

  return false;
}

function addCodeBlockChromeWithServerWalker(html: string, themeClass: string) {
  let output = '';
  let cursor = 0;
  let scan = 0;

  while (scan < html.length) {
    const tag = findNextHtmlTag(html, scan);
    if (!tag) break;
    scan = tag.end + 1;

    if (tag.name !== 'pre' || tag.closing || tag.selfClosing) continue;

    const close = findMatchingCloseTag(html, 'pre', tag.end + 1);
    if (!close) continue;

    if (hasDirectCodeChild(html, tag.end + 1, close.start)) {
      output += html.slice(cursor, tag.start);
      output += codeBlockWrapperStart(themeClass);
      output += html.slice(tag.start, close.end + 1);
      output += '</div>';
      cursor = close.end + 1;
    }

    scan = close.end + 1;
  }

  output += html.slice(cursor);
  return output;
}

function addCodeBlockChrome(html: string, codeTheme: CodeTheme) {
  const themeClass = codeTheme === 'light' ? 'chorus-codeblock-light' : 'chorus-codeblock-dark';
  return addCodeBlockChromeWithDOM(html, themeClass) ?? addCodeBlockChromeWithServerWalker(html, themeClass);
}

function getCodeCopyText(codeEl: HTMLElement | null) {
  const raw = codeEl?.textContent ?? codeEl?.innerText ?? '';
  return raw.replace(/\r?\n$/, '');
}

export function Markdown({ text, codeTheme = 'dark', headless = false, streaming = false, sanitizer, markedOptions, markedExtensions }: MarkdownProps) {
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

    const sanitized = renderMarkdown(text, sanitizer, markedOptions, markedExtensions);
    if (headless) return sanitized;

    return addCodeBlockChrome(sanitized, codeTheme);
  }, [text, codeTheme, headless, hljsReady, streaming, sanitizer, markedOptions, markedExtensions]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === 'undefined' || typeof document === 'undefined' || typeof navigator === 'undefined' || !navigator?.clipboard) return;

    const handleCopy = async (btn: HTMLElement) => {
      const wrapper = btn.closest('.chorus-codeblock') as HTMLElement | null;
      const codeEl = wrapper?.querySelector('pre > code') as HTMLElement | null;
      const raw = getCodeCopyText(codeEl);
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
