import type { CodeTheme } from '../../../utils/hljsLoader';
import { DEFAULT_CODE_COPY_LABELS } from '../../../labels/codeCopy';
import type { ChorusCodeCopyLabels } from '../../../labels/types';
import {
  escapeHtmlAttribute,
  escapeHtmlText,
  findMatchingCloseTag,
  findNextHtmlTag,
  hasDirectCodeChild,
} from './htmlScanner';

/** Context handed to a custom {@link CodeBlockCopyRenderer}. */
export interface CodeBlockCopyContext {
  /** Code theme applied to the wrapping `.chorus-codeblock` element. */
  theme: CodeTheme;
  /** Resolved (already localized) copy-button labels. */
  labels: ChorusCodeCopyLabels;
}

/**
 * Custom renderer for the per-code-block copy chrome.
 *
 * Return an HTML string; it is inserted verbatim as the first child of the
 * `.chorus-codeblock` wrapper, before the `<pre>`. To keep the built-in
 * clipboard behavior, include an element with the `chorus-copy-btn` class —
 * `useCodeCopy` delegates click/keyboard events from it. Include a
 * `chorus-copy-status` element (ideally `aria-live="polite"`) to receive
 * screen-reader status updates on copy success/failure.
 *
 * The returned markup is inserted as-is and is **not** sanitized; treat it as
 * trusted, component-authored HTML (same trust model as `markedExtensions`).
 */
export type CodeBlockCopyRenderer = (ctx: CodeBlockCopyContext) => string;

/**
 * Controls the copy chrome injected around fenced code blocks.
 * - `'default'` / `true` / omitted: the built-in accessible copy `<button>`.
 * - `false`: no copy chrome (the styled `.chorus-codeblock` wrapper remains).
 * - a {@link CodeBlockCopyRenderer}: render your own chrome.
 */
export type CodeBlockCopy = boolean | 'default' | CodeBlockCopyRenderer;

/** Built-in copy chrome: a real, keyboard-focusable button plus a polite live region. */
function defaultCopyChromeHtml(labels: ChorusCodeCopyLabels) {
  return (
    `<button type="button" class="chorus-copy-btn" aria-label="${escapeHtmlAttribute(labels.ariaLabel)}">` +
    `${escapeHtmlText(labels.copy)}</button>` +
    '<span class="chorus-copy-status" role="status" aria-live="polite"></span>'
  );
}

/** Resolves the `codeBlockCopy` prop into the HTML inserted ahead of each `<pre>`. */
export function resolveCopyChromeHtml(copy: CodeBlockCopy, theme: CodeTheme, labels: ChorusCodeCopyLabels): string {
  if (copy === false) return '';
  if (typeof copy === 'function') return copy({ theme, labels });
  return defaultCopyChromeHtml(labels);
}

export function addCodeBlockChromeWithDOM(html: string, themeClass: string, chromeHtml: string) {
  if (typeof DOMParser === 'undefined') return undefined;

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const codeBlocks = Array.from(doc.querySelectorAll('pre > code'));

    for (const code of codeBlocks) {
      const pre = code.parentElement;
      if (!pre || pre.parentElement?.classList.contains('chorus-codeblock')) continue;

      const wrapper = doc.createElement('div');
      wrapper.className = `chorus-codeblock ${themeClass}`;

      pre.parentNode?.insertBefore(wrapper, pre);
      if (chromeHtml) wrapper.innerHTML = chromeHtml;
      wrapper.appendChild(pre);
    }

    return doc.body.innerHTML;
  } catch {
    return undefined;
  }
}

export function addCodeBlockChromeWithServerWalker(html: string, themeClass: string, chromeHtml: string) {
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
      output += `<div class="chorus-codeblock ${themeClass}">${chromeHtml}`;
      output += html.slice(tag.start, close.end + 1);
      output += '</div>';
      cursor = close.end + 1;
    }

    scan = close.end + 1;
  }

  output += html.slice(cursor);
  return output;
}

export function addCodeBlockChrome(
  html: string,
  codeTheme: CodeTheme,
  labels: ChorusCodeCopyLabels = DEFAULT_CODE_COPY_LABELS,
  copy: CodeBlockCopy = 'default',
) {
  const themeClass = codeTheme === 'light' ? 'chorus-codeblock-light' : 'chorus-codeblock-dark';
  const chromeHtml = resolveCopyChromeHtml(copy, codeTheme, labels);
  return (
    addCodeBlockChromeWithDOM(html, themeClass, chromeHtml) ??
    addCodeBlockChromeWithServerWalker(html, themeClass, chromeHtml)
  );
}
