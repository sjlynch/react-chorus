# components guide

## `ChatWindow`

Message list and auto-scroll container. It filters roles via `hiddenRoles` (default hides `system` and `tool`), uses a bottom sentinel, and schedules `scrollIntoView` with `requestAnimationFrame` to avoid scroll jank. It also renders edit/regenerate/delete controls, typing state, retry errors, custom `renderMessage`, and `ToolCallBlock` for visible tool messages.

## `ChatInput`

Textarea plus send/stop button and optional file attachment UI (`accept` enables attach). Enter sends, Shift+Enter inserts a newline, and attached files are read as data URLs. Intended growth is capped at 160px; current code enforces that with CSS `max-height` and has no separate JS auto-resize helper.

## `Markdown`

Uses a private `Marked` instance, not the global singleton, so host app marked configuration is not mutated. It lazy-loads `highlight.js` and a raw theme CSS file on first code fence. Highlight CSS is scoped under `.chorus-codeblock-{theme}` classes, and rendered HTML is sanitized with DOMPurify in the browser.

## `ChorusTheme`

Standalone wrapper that applies palette CSS variables via `styleVarsFromPalette`. It is not used as the `Chorus` root wrapper; `Chorus.tsx` merges palette variables directly into the root div `style` prop.

## `MessageBubble`

Exported from `ChatWindow.tsx` for use in `renderMessage` render-props. It wraps the default role class and `Markdown`; the built-in row renderer also handles attachments.

## `ToolCallBlock`

Collapsible block for tool call messages. It shows the tool name and expands to pretty-printed input/output when present.
