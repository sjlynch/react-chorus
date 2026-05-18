# utils guide

## `attachmentPreview.ts`

`getAttachmentPreviewSource()` returns the first renderable attachment source (`url` before `data`) for image thumbnails in `MessageRow` and `ChatInput`. Use it before assigning attachment data to `src`; it deliberately allows only `data:`, `blob:`, and `http(s):` values so provider file ids or local file URIs are not rendered as URLs.

## `devMode.ts`

`isChorusDevMode()` is the shared dev-warning gate for modules that can import this util. `ChatWindow.tsx` intentionally keeps a local duplicate to avoid coupling hook-only chunks to ChatWindow code, and `components/conversation-list/useDeleteConversationConfirmation.ts` inlines the same gate inside `warnDeleteConfirmationError` for the same reason (the shared helper would pull the assistant-session chunk into ConversationList's graph). Keep new diagnostics behind one of these gates and, when inlining, mirror the explanatory comment so a future reader knows the duplication is deliberate.

## `hljsLoader.ts`

Lazy-loads `highlight.js` and scoped light/dark theme CSS for finalized Markdown code fences. `getHljs()` and `loadHljsTheme()` use module-level promises plus DOM id checks so concurrent renders share one import/injected style; if changing failure handling, keep highlighting optional and retryable instead of blocking plain Markdown rendering.

## `markdownNormalizer.ts`

`normalizeStreamingMarkdown()` patches finalized streamed text by closing unbalanced line-start ``` or ~~~ fences before Marked parses it. Use it only at the final Markdown-rendering boundary; the active streaming path renders escaped plain text instead of reparsing partial markdown.

## `messageCopy.ts`

Clipboard helpers and labels shared by the `ChatWindow`/`MessageRow` copy action and `Markdown` code-block copy buttons. `COPY_FEEDBACK_DURATION_MS` defines the feedback timeout and `COPY_FAILED_LABEL` keeps failure UI consistent; helpers return `false` and call `onError` on missing/failed Clipboard API rather than throwing.
