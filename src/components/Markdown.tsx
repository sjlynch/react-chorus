import React from 'react';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

// Marked configuration:
// - Use GFM + single-line breaks
// - Add syntax highlighting via marked-highlight + highlight.js
marked.setOptions({ gfm: true, breaks: true, mangle: false, headerIds: false });
marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code: string, lang?: string) {
    try {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
      return hljs.highlightAuto(code).value;
    } catch {
      return code;
    }
  }
}));

// During streaming, a code fence can be opened but not yet closed.
// We temporarily append a closing fence so code renders as a block mid-stream.
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
  patchFence('```'); patchFence('~~~');
  return out;
}

export function Markdown({ text, codeTheme = 'dark' }: { text: string; codeTheme?: 'dark' | 'light' }) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Inject minimal CSS once per page for code blocks + copy button
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('chorus-md-styles')) return;
    const style = document.createElement('style');
    style.id = 'chorus-md-styles';
    style.textContent =
      `.chorus-md .chorus-codeblock{position:relative;margin:8px 0;border-radius:8px;overflow:auto;border:1px solid var(--chorus-code-border,#30363d)}
       .chorus-md .chorus-codeblock pre{margin:0;padding:12px 16px;background:transparent}
       .chorus-md .chorus-codeblock-dark{background:#0d1117;--chorus-code-border:#30363d;color:#e6edf3}
       .chorus-md .chorus-codeblock-light{background:#f6f8fa;--chorus-code-border:#d0d7de;color:#24292f}
       .chorus-md .chorus-copy-btn{position:absolute;top:8px;right:8px;font-size:12px;padding:4px 8px;border-radius:6px;cursor:pointer;user-select:none}
       .chorus-md .chorus-codeblock-dark .chorus-copy-btn{background:rgba(240,246,252,0.08);border:1px solid rgba(240,246,252,0.1);color:#e6edf3}
       .chorus-md .chorus-codeblock-light .chorus-copy-btn{background:#fff;border:1px solid rgba(31,35,40,0.15);color:#24292f}
       .chorus-md .chorus-copy-btn.copied{opacity:.85}`;
    document.head.appendChild(style);
  }, []);

  const html = React.useMemo(() => {
    const balanced = normalizeStreamingMarkdown(text);

    // 1) render markdown with highlighting
    let raw = '';
    try {
      raw = marked.parse(balanced) as string;
    } catch {
      // If marked throws (rare mid-stream), show plain text inside <pre>
      raw = `<pre><code>${balanced}</code></pre>`;
    }

    // 2) sanitize
    const sanitized = typeof window === 'undefined' ? raw : DOMPurify.sanitize(raw);

    // 3) post-process <pre><code> to wrap with our codeblock container + copy button
    if (typeof window === 'undefined') return sanitized;
    const root = document.createElement('div');
    root.innerHTML = sanitized;

    const themeClass = codeTheme === 'light' ? 'chorus-codeblock-light' : 'chorus-codeblock-dark';
    root.querySelectorAll('pre > code').forEach(codeEl => {
      const pre = codeEl.parentElement as HTMLElement;
      if (!pre) return;
      const alreadyWrapped = pre.parentElement && pre.parentElement.classList.contains('chorus-codeblock');
      if (alreadyWrapped) return;

      const wrapper = document.createElement('div');
      wrapper.className = `chorus-codeblock ${themeClass}`;

      const btn = document.createElement('span');
      btn.className = 'chorus-copy-btn';
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', 'Copy code');
      btn.setAttribute('tabindex', '0');
      btn.textContent = 'Copy';

      pre.replaceWith(wrapper);
      wrapper.appendChild(btn);
      wrapper.appendChild(pre);
    });

    return root.innerHTML;
  }, [text, codeTheme]);

  // Event delegation for copy buttons
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === 'undefined' || typeof document === 'undefined' || !navigator?.clipboard) return;

    const handleCopy = async (btn: HTMLElement) => {
      const wrapper = btn.closest('.chorus-codeblock') as HTMLElement | null;
      const codeEl = wrapper?.querySelector('pre > code') as HTMLElement | null;
      const raw = codeEl?.innerText ?? '';
      try {
        await navigator.clipboard.writeText(raw);
        const prev = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = prev || 'Copy'; btn.classList.remove('copied'); }, 1200);
      } catch {}
    };

    const onClick = (e: MouseEvent) => {
      const tgt = e.target as HTMLElement;
      const btn = tgt?.closest?.('.chorus-copy-btn') as HTMLElement | null;
      if (btn) handleCopy(btn);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      const btn = tgt?.closest?.('.chorus-copy-btn') as HTMLElement | null;
      if (!btn) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCopy(btn); }
    };

    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKeyDown);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKeyDown); };
  }, []);

  return <div ref={containerRef} className="chorus-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
