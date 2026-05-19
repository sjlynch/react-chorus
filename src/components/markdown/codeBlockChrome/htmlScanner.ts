export const VOID_HTML_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

export interface HtmlTagMatch {
  start: number;
  end: number;
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

export function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeHtmlText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function isHtmlNameChar(char: string | undefined) {
  return !!char && /[A-Za-z0-9:-]/.test(char);
}

export function isAsciiWhitespace(char: string | undefined) {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f';
}

export function findHtmlTagEnd(html: string, start: number) {
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

export function readHtmlTag(html: string, start: number): HtmlTagMatch | null {
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

export function findNextHtmlTag(html: string, from: number): HtmlTagMatch | null {
  let start = html.indexOf('<', from);

  while (start !== -1) {
    const tag = readHtmlTag(html, start);
    if (tag) return tag;
    start = html.indexOf('<', start + 1);
  }

  return null;
}

export function findMatchingCloseTag(html: string, tagName: string, from: number) {
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

export function hasDirectCodeChild(html: string, from: number, to: number) {
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
