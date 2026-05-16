import type { CodeTheme } from '../../utils/hljsLoader';
import { COPY_LABEL } from './useCodeCopy';

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
  return `<span class="chorus-copy-btn" role="button" aria-label="Copy code" tabindex="0">${COPY_LABEL}</span>`;
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
      copyButton.textContent = COPY_LABEL;

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

export function addCodeBlockChrome(html: string, codeTheme: CodeTheme) {
  const themeClass = codeTheme === 'light' ? 'chorus-codeblock-light' : 'chorus-codeblock-dark';
  return addCodeBlockChromeWithDOM(html, themeClass) ?? addCodeBlockChromeWithServerWalker(html, themeClass);
}
