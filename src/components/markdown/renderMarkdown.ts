import type { Marked } from 'marked';
import { normalizeStreamingMarkdown } from '../../utils/markdownNormalizer';
import { escapeHtml, type SanitizerFn } from './sanitize';

function parseWithMarked(instance: Marked, text: string) {
  try {
    return instance.parse(text) as string;
  } catch {
    return `<pre><code>${escapeHtml(text)}</code></pre>`;
  }
}

export function renderMarkdown(text: string, sanitizer: SanitizerFn | undefined, markedInstance: Marked) {
  const balanced = normalizeStreamingMarkdown(text);
  const parsed = parseWithMarked(markedInstance, balanced);

  if (!sanitizer) return parsed;
  return sanitizer(parsed);
}
