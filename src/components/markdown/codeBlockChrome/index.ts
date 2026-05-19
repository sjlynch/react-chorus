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

function copyButtonHtml(labels: ChorusCodeCopyLabels) {
  return `<span class="chorus-copy-btn" role="button" aria-label="${escapeHtmlAttribute(labels.ariaLabel)}" tabindex="0">${escapeHtmlText(labels.copy)}</span>`;
}

function codeBlockWrapperStart(themeClass: string, labels: ChorusCodeCopyLabels) {
  return `<div class="chorus-codeblock ${themeClass}">${copyButtonHtml(labels)}`;
}

export function addCodeBlockChromeWithDOM(html: string, themeClass: string, labels: ChorusCodeCopyLabels) {
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
      copyButton.setAttribute('aria-label', labels.ariaLabel);
      copyButton.setAttribute('tabindex', '0');
      copyButton.textContent = labels.copy;

      pre.parentNode?.insertBefore(wrapper, pre);
      wrapper.append(copyButton, pre);
    }

    return doc.body.innerHTML;
  } catch {
    return undefined;
  }
}

export function addCodeBlockChromeWithServerWalker(html: string, themeClass: string, labels: ChorusCodeCopyLabels) {
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
      output += codeBlockWrapperStart(themeClass, labels);
      output += html.slice(tag.start, close.end + 1);
      output += '</div>';
      cursor = close.end + 1;
    }

    scan = close.end + 1;
  }

  output += html.slice(cursor);
  return output;
}

export function addCodeBlockChrome(html: string, codeTheme: CodeTheme, labels: ChorusCodeCopyLabels = DEFAULT_CODE_COPY_LABELS) {
  const themeClass = codeTheme === 'light' ? 'chorus-codeblock-light' : 'chorus-codeblock-dark';
  return addCodeBlockChromeWithDOM(html, themeClass, labels) ?? addCodeBlockChromeWithServerWalker(html, themeClass, labels);
}
