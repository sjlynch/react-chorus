# utils guide

## `attachmentPreview.ts`

`getAttachmentPreviewSource()` returns the first renderable attachment source (`url` before `data`, skipping a defined-but-unrenderable `url` so a valid `data:` URL still previews) for image thumbnails in `MessageRow` and `ChatInput`. Use it before assigning attachment data to `src`. `isRenderableAttachmentSource()` allows `blob:`/`http(s):` values (no inline MIME, rendered via `<img>`) and only a curated set of `data:` MIME types — safe raster images, PDF, `audio/*`, `video/*`. Script-capable `data:` types (`image/svg+xml`, `text/html`, `application/xhtml+xml`) and malformed `data:` URLs are routed to no preview, so provider file ids, local file URIs, and XSS-prone payloads are never rendered.

## `devMode.ts`

`isChorusDevMode()` is the shared dev-warning gate for the component- and hook-side bundle. It is a zero-dependency leaf, so importing it does not drag any heavier chunk along — the hooks plus the component files (`ChatWindow.tsx`, `chat-window/rendering.tsx`, `conversation-list/useDeleteConversationConfirmation.ts`) all import it directly from here.

The streaming/transport sub-bundles deliberately do **not** import this util: they keep their own leaf copy in `src/streaming/internal/devMode.ts` (`isStreamDevMode`) so the transport-only subpaths never pull in the utils-owned chunk and blow their bundle-size budgets. Keep new diagnostics behind one of these two gates — pick the `streaming/internal` one only for code that ships in the transport/streaming chunks.

## `hljsLoader.ts` and `hljs/`

`hljsLoader.ts` is the compatibility facade for the focused `hljs/` modules. They lazy-load `highlight.js` and scoped light/dark theme CSS for finalized Markdown code fences; `getHljs()` and `loadHljsTheme()` use module-level promises plus DOM id checks so concurrent renders share one import/injected style. If changing failure handling, keep highlighting optional and retryable instead of blocking plain Markdown rendering, and see `hljs/CLAUDE.md` before editing CSS scoping.

## `markdownNormalizer.ts`

`normalizeStreamingMarkdown()` patches finalized streamed text by closing unbalanced line-start ``` or ~~~ fences before Marked parses it. Use it only at the final Markdown-rendering boundary; the active streaming path renders escaped plain text instead of reparsing partial markdown.

## `messageCopy.ts`

Clipboard helpers and labels shared by the `ChatWindow`/`MessageRow` copy action and `Markdown` code-block copy buttons. `COPY_FEEDBACK_DURATION_MS` defines the feedback timeout and `COPY_FAILED_LABEL` keeps failure UI consistent; helpers return `false` and call `onError` on missing/failed Clipboard API rather than throwing.
