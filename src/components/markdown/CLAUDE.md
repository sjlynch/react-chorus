# markdown internals guide

`../Markdown.tsx` is the public facade. Keep public exports there (`Markdown`, `MarkdownProps`, `MarkdownSanitizer`, `normalizeStreamingMarkdown`) and put implementation details in this folder.

Pipeline boundaries:
- `marked.ts` creates private Marked instances, installs `marked-highlight`, and applies the safe renderer when no sanitizer is available. Custom `markedOptions`/`markedExtensions` are selected by the facade with `useMemo` keyed by option/extension identity plus safe mode.
- `sanitize.ts` resolves custom sanitizers/DOMPurify and owns URL/entity decoding used by safe-mode links and images. Treat changes here as security-sensitive.
- `renderMarkdown.ts` balances streaming fences, parses with the selected Marked instance, and applies the resolved sanitizer.
- `highlight.ts` is the React lazy-loading hook for highlight.js and scoped theme CSS. Import failures must be caught by callers and remain retryable in `utils/hljsLoader.ts` / `utils/hljs/`.
- `codeBlockChrome/` injects copy chrome around `<pre><code>` blocks: `index.ts` exposes `addCodeBlockChrome` plus the DOMParser and server-walker writers, the `CodeBlockCopy` prop type, and `resolveCopyChromeHtml` (turns `'default'`/`false`/a renderer function into the HTML inserted ahead of each `<pre>`). The default chrome is a real `<button>` plus a polite `aria-live` status region. `htmlScanner.ts` holds the self-contained mini HTML tokenizer (tag scanning + escape helpers) the server walker is built on.
- `useCodeCopy.ts` owns delegated clipboard events, button feedback timers, `onCopyError` reporting, and keeping the button's `aria-label` + the `chorus-copy-status` live region in sync with the Copy/Copied/Failed state. It only polyfills Enter/Space for non-`<button>` custom chrome.
