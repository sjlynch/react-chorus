import React from 'react';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

// Highlight.js integration for syntax highlighting
marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    try {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
      return hljs.highlightAuto(code).value;
    } catch {
      return code;
    }
  }
}));

// Markdown options
marked.setOptions({
  gfm: true,
  breaks: true,
  mangle: false,
  headerIds: false
});

// Heuristic: during streaming, if a code fence is opened but not yet closed,
// append a temporary closing fence so the partial content renders as a code block.
// This gives "ChatGPT-like" code formatting while tokens are still arriving.
function normalizeStreamingMarkdown(text: string) {
  let out = text;

  const patchFence = (fence: '```' | '~~~') => {
    let count = 0, i = 0;
    while (true) {
      const pos = out.indexOf(fence, i);
      if (pos === -1) break;
      count++;
      i = pos + fence.length;
    }
    if (count % 2 === 1) out += `\n${fence}`;
  };

  patchFence('```');
  patchFence('~~~');
  return out;
}

export function Markdown({ text }: { text: string }) {
  const html = React.useMemo(() => {
    const balanced = normalizeStreamingMarkdown(text);
    const raw = marked.parse(balanced) as string;
    return typeof window === 'undefined' ? raw : DOMPurify.sanitize(raw);
  }, [text]);

  return <div className="chorus-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
