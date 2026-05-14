# components guide

## `ChatWindow`

Message list and auto-scroll container. It filters roles via `hiddenRoles` (default hides `system` and `tool`), uses a bottom sentinel, and schedules `scrollIntoView` with `requestAnimationFrame` to avoid scroll jank. It also renders edit/regenerate/delete controls, typing state, retry errors, custom `renderMessage`, and `ToolCallBlock` for visible tool messages.

## `ChatInput`

Textarea plus send/stop button and optional file attachment UI (`accept` enables attach). Enter sends, Shift+Enter inserts a newline, and attached files are read as data URLs. `resizeTextarea()` is the JS auto-resize helper: on change it resets height to `auto`, then sets `min(scrollHeight, 160px)`; CSS also caps growth with `max-height`, and height resets after send.

## `Markdown`

Uses a private `Marked` instance, not the global singleton, so host app marked configuration is not mutated. Finalized markdown normalizes incomplete fences, parses once per memo, sanitizes with a provided sanitizer, `DOMPurify.sanitize` when available, or a fallback sanitizer for SSR/no-DOMPurify environments, then adds code-block chrome unless `headless`. While `streaming` is true it skips parsing/highlighting and renders React-escaped plain text with pre-wrap until finalization; `highlight.js` and theme CSS lazy-load only for finalized code fences.

## `ChorusTheme`

Standalone wrapper that applies palette CSS variables via `styleVarsFromPalette`. It is not used as the `Chorus` root wrapper; `Chorus.tsx` merges palette variables directly into the root div `style` prop.

## `MessageBubble`

Exported from `ChatWindow.tsx` for use in `renderMessage` render-props. It wraps the default role class and bubble, renders `message.reasoning` as a collapsed details block, renders `message.attachments` (image previews or file names), and passes text through `Markdown`. The built-in `MessageRow` uses the same attachment/reasoning renderer and adds edit/regenerate/delete actions.

## `ToolCallBlock`

Collapsible block for tool call messages. It shows the tool name and expands to pretty-printed input/output when present.
