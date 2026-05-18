# utils/hljs guide

- `lazyImport.ts` owns retryable cached dynamic imports; rejected loads must clear the cached promise so future renders can retry.
- `core.ts` owns the module-level highlight.js singleton and optional `highlightCode()` fallback behavior for Markdown.
- `theme.ts` owns raw light/dark CSS imports, SSR no-op loading, style id de-duping, and injected style caching.
- `cssScope.ts` is intentionally parser-like (comments, quotes, selector commas, braces, semicolons, and nesting at-rules). Do not replace it with simple regex/split logic; Markdown tests cover the scoping edge cases.
