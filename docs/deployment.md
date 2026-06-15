# Deployment notes

Bundle size, SSR rendering, and Content-Security-Policy guidance for shipping react-chorus to production.

- [Bundle size](#bundle-size)
- [SSR and Markdown sanitization](#ssr-and-markdown-sanitization)
- [Security and CSP](#security-and-csp)

## Bundle size

react-chorus keeps React/ReactDOM as peer dependencies and externalizes runtime packages (`@modelcontextprotocol/sdk`, `dompurify`, `marked`, `marked-highlight`, `lucide-react`, and `highlight.js`) from the published library build. They remain regular `dependencies` so installs work out of the box, while app bundlers can dedupe them and pick up compatible dependency fixes without a react-chorus republish.

`npm run verify:bundle-size` builds tiny consumer bundles from the published entry points with React peers excluded, reports minified/gzip sizes, writes a machine-readable report to `.cache/react-chorus/library-bundle-size-report.json`, and fails CI if budgets are exceeded, external/lazy dependencies move into the wrong graph, root named imports stop tree-shaking, or the numbers on this page drift from the report. Root named imports are expected to tree-shake in modern side-effects-aware bundlers; the low-cost transport and provider helper paths are also available as subpaths for server/utility code. Current numbers:

| Entry | Initial JS | gzip | Notes |
|-------|------------|------|-------|
| `react-chorus` (`<Chorus>`) | 287.1 kB | 91.9 kB | Full widget path; includes Markdown parsing/sanitization and icons. |
| `react-chorus/headless` | 287.4 kB | 92.1 kB | Headless defaults, same behavior surface. |
| `react-chorus` (`useChorusStream`) | 84.6 kB | 25.3 kB | Root hook import; CI fails if it pulls UI, Markdown, or icon dependencies. |
| `react-chorus` (`Markdown`) | 76.3 kB | 26.1 kB | Standalone Markdown renderer; includes Markdown parsing/sanitization, not chat icons. |
| `react-chorus` (`ChatWindow`) | 234.2 kB | 74.9 kB | Transcript renderer with Markdown and message action icons, without the composer/widget shell. |
| `react-chorus` (`ConversationList`) | 9.0 kB | 3.1 kB | Conversation sidebar component only; no Markdown/icon graph. |
| `react-chorus/transport` | 7.6 kB | 3.1 kB | Transport factories only; no React/UI/Markdown runtime. |
| `react-chorus/provider-requests` | 13.0 kB | 4.2 kB | Provider request mappers and tool serializers; no React/UI/Markdown runtime. |
| `react-chorus/server` | 0.7 kB | 0.4 kB | SSE framing helpers for proxy routes (headers, encode/format, [DONE], error envelope); no React/UI runtime. |
| `react-chorus/blocks` | 10.1 kB | 3.6 kB | Generative-UI starter blocks + `BlockRenderer`; no Markdown/icon/widget graph. CI fails if the lazy `highlight.js` runtime is statically reachable. |
| `react-chorus/blocks/Chart` | 2.8 kB | 1.6 kB | Standalone Chart block only; `recharts` stays an optional, runtime-resolved dependency. |
| `react-chorus/loaders` | 2.5 kB | 1.1 kB | Built-in tool-loading presets (`SpinnerLoader`, `SkeletonTable`, `MapPing`, `CodeShimmer`, `DefaultToolLoader`). |
| `react-chorus/validators` | 0.8 kB | 0.3 kB | Pure adapter functions for Zod / Valibot / JSON-Schema validators; no peer runtime. |
| `react-chorus/pricing` | 0.8 kB | 0.3 kB | `PRICING` snapshot data used by the cost meter; no React or runtime helpers. |
| Lazy `highlight.js` runtime | 891.7 kB | 296.2 kB | Async code-fence chunk, never part of initial JS. |

`highlight.js` is only fetched the first time a fenced code block (` ``` ` or `~~~`) appears in rendered text. The matching GitHub dark/light token-color stylesheet is also injected on demand based on `codeBlockTheme`; code renders immediately as plain text and is re-rendered with syntax highlighting once the chunk arrives. While an assistant message is actively streaming, Chorus renders that growing message as React-escaped plain text and switches to full Markdown parsing/sanitization when the stream finalizes.

The playground has a separate budget because it intentionally bundles a complete demo app. `npm run build:playground` also runs `npm run verify:playground-size`, writes `.cache/react-chorus/playground-bundle-size-report.json`, and checks this paragraph. The current playground initial JS graph is 534.6 kB / 166.7 kB gzip and its largest lazy chunk (highlight.js) is 890.9 kB / 295.7 kB gzip. Vite's chunk warning limit is raised to that documented lazy budget so the playground build stays free of Vite chunk warnings while the budget script tracks regressions.

To refresh the published size claims after dependency or feature changes, run `npm run build`, `npm run verify:bundle-size`, and `npm run build:playground`, then copy the updated values from stdout or the `.cache/react-chorus/*-bundle-size-report.json` files into this section. The verification commands may fail until the values on this page are updated to match their reports.

## SSR and Markdown sanitization

`<Markdown>` sanitizes rendered HTML before using `dangerouslySetInnerHTML`. In the browser it uses `dompurify` (or initializes the DOMPurify factory with `window` when needed). During SSR, if no real DOMPurify-compatible sanitizer is available, react-chorus does **not** attempt regex-based HTML sanitization; it switches to a safe no-raw-HTML renderer that drops raw HTML tokens and only emits Markdown-generated links/images with safe URL protocols. Ordinary Markdown (`**bold**`, headings, lists, code, safe `http`/`https` links) renders the same on server and client.

If your SSR app wants to allow sanitized raw HTML, create an isomorphic DOMPurify instance (for example with your framework's DOM/window or jsdom on the server) and pass it to the standalone renderer: `<Markdown sanitizer={purify} />` or `<Markdown sanitizer={(html) => purify.sanitize(html)} />`. The built-in chat renderer accepts the same customization via `<Chorus markdownSanitizer={purify} />` / `<ChatWindow markdownSanitizer={purify} />`, or through `markdownProps={{ sanitizer: purify }}`. You can also pass `markedOptions` and `markedExtensions` directly to `<Markdown>` or via `markdownProps` to adjust parsing and register marked extensions without mutating marked's global singleton.

Code-block copy buttons flash `Copied!` on success and `Copy failed` when the Clipboard API rejects. Pass `<Markdown onCopyError={(error) => ...} />` — or `markdownProps={{ onCopyError }}` on `<Chorus>` / `<ChatWindow>` — to show your own toast or fallback alert.

The copy chrome is a real, keyboard-focusable `<button>`: it activates with Enter/Space, keeps its accessible name (`aria-label`) in sync with the Copy / Copied / Failed state, and announces each transition through a polite `aria-live` status region next to it.

Use `codeBlockCopy` on `<Markdown>` (or `markdownProps={{ codeBlockCopy }}` on `<Chorus>` / `<ChatWindow>`) to control that chrome — its prop type is the exported `CodeBlockCopy` union:

- `'default'` (or `true`, or omitted) keeps the built-in copy button.
- `false` opts out entirely — no copy button is rendered, while the styled `.chorus-codeblock` wrapper stays.
- a function `(ctx) => htmlString` — the exported `CodeBlockCopyRenderer` type — renders your own chrome. `ctx` is a `CodeBlockCopyContext` (`{ theme, labels }`); the returned HTML is inserted ahead of the `<pre>`. Include a `chorus-copy-btn` element to reuse the built-in clipboard wiring, and a `chorus-copy-status` element (ideally `aria-live="polite"`) to receive screen-reader status updates. The returned markup is trusted and inserted without sanitization, so pass a stable function reference.

```tsx
// Opt out of the copy button entirely
<Markdown text={md} codeBlockCopy={false} />

// Render your own chrome (defined once, outside render)
const renderCopy = ({ labels }) =>
  `<button type="button" class="chorus-copy-btn" aria-label="${labels.ariaLabel}">⧉</button>` +
  `<span class="chorus-copy-status" role="status" aria-live="polite"></span>`;
<Markdown text={md} codeBlockCopy={renderCopy} />
```

## Security and CSP

react-chorus is designed to run under a strict Content-Security-Policy. Concretely:

- **No inline scripts.** The library never injects `<script>` tags, never uses `eval` / `new Function`, and DOMPurify is the underlying-API-only build that runs entirely on DOM nodes. `script-src 'self'` (no `'unsafe-inline'`, no `'unsafe-eval'`) is sufficient — DOMPurify does **not** require `'unsafe-eval'`.
- **`highlight.js` is a dynamic `import()`.** It is shipped as a regular script chunk loaded from your own origin (or wherever your bundler emits assets), so `script-src 'self'` already covers it. If you serve bundles from a CDN, add that origin to `script-src`. The chunk is only fetched the first time a fenced code block appears in rendered text — apps that never render fenced code never download it.
- **Sanitized HTML is rendered, not executed.** Markdown is parsed, the resulting HTML is sanitized with DOMPurify (or the SSR no-raw-HTML fallback described above), and only then mounted via `dangerouslySetInnerHTML`. DOMPurify strips `<script>`, `on*` handlers, and unsafe URL protocols; Markdown-emitted `<a>` / `<img>` URLs are restricted to safe protocols.
- **Default styling injects inline styles, so `style-src` needs `'unsafe-inline'` (or a nonce + headless).** The default (non-headless) render path adds two runtime-injected `<style>` elements — `#chorus-md-styles` (Markdown code-block chrome, from `components/Markdown.tsx`) and `#chorus-hljs-theme-<theme>` (highlight.js token colors, from `utils/hljs/theme.ts`) — and a number of inline `style=""` attributes (palette CSS variables on the `<Chorus>` root and `<ChorusTheme>`, and a few layout properties on internal elements). `style-src 'self'` alone blocks all of these. See *Strict CSP without `'unsafe-inline'`* below for nonce and headless escape hatches. DOMPurify also keeps `style` attributes on whitelisted tags by default, so Markdown-rendered output may carry sanitized inline styles; remove them with `<Markdown sanitizer={(html) => purify.sanitize(html, { FORBID_ATTR: ['style'] })} />` if you want to strip user-authored ones.
- **`connect-src` is whatever you POST/upgrade to.** Chorus only talks to the URL you give `transport`, so list your own API origin (and any WebSocket origin) under `connect-src`.

A minimal CSP for an app embedding the default `<Chorus />` against a same-origin `/api/chat` proxy:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
worker-src 'self';
frame-ancestors 'none';
base-uri 'self';
object-src 'none';
```

Notes for tightening or relaxing this baseline:

- Add `data:` / `blob:` to `img-src` if you accept image attachments (the composer previews dropped/pasted files as `blob:` URLs, and image data URLs can show up in rendered Markdown).
- Add your provider origin(s) to `connect-src` only if the browser talks directly to a provider; the recommended `react-chorus/server` proxy pattern keeps `connect-src 'self'`.
- Add a WebSocket origin (e.g. `connect-src 'self' wss://api.example.com`) when using `createWebSocketTransport` against a different host.

### Strict CSP without `'unsafe-inline'`

To drop `'unsafe-inline'` from `style-src`, both runtime style surfaces need to be removed or whitelisted:

1. **Allow the two injected `<style>` blocks with a nonce.** Generate a per-response CSP nonce, set it on the page (e.g. `<meta property="csp-nonce" content="...">` plus `style-src 'self' 'nonce-XYZ'`), and call `setChorusStyleNonce(nonce)` once during app startup before any `<Markdown>` / `<Chorus>` renders or highlight.js theme loads. The nonce is applied to the `chorus-md-styles` and `chorus-hljs-theme-*` `<style>` tags as they are created. (`setChorusStyleNonce` also reads a global `__chorusStyleNonce` if you prefer to set it from an inline bootstrap script.) Nonces are *not* honored on inline `style=""` attributes by browsers — see step 2.
2. **Avoid inline `style=""` attributes.** `style-src-attr` (CSP3) blocks element-level inline styles even when a nonce is provided. The default `<Chorus>` root and `<ChorusTheme>` apply palette CSS variables through React's `style` prop, and several built-in widgets set narrow layout properties the same way. Use the `react-chorus/headless` entry (no default `<style>` injection and no built-in code-block chrome), omit `palette` (define `--chorus-*` variables in your own stylesheet instead), and supply your own CSS for the components you mount. If you cannot avoid attribute styles, allow them explicitly with `style-src-attr 'unsafe-inline'` while keeping `style-src 'self' 'nonce-XYZ'` for `<style>` elements.

A strict-CSP example built around nonce + headless looks like:

```
default-src 'self';
script-src 'self';
style-src 'self' 'nonce-XYZ';
style-src-attr 'none';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
worker-src 'self';
frame-ancestors 'none';
base-uri 'self';
object-src 'none';
```

Paired with `import { Chorus, setChorusStyleNonce } from 'react-chorus/headless'; setChorusStyleNonce('XYZ');` and an app-owned stylesheet that defines the `--chorus-*` palette variables.
