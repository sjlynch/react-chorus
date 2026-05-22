# components guide

## `ChatWindow`

Message list and auto-scroll container. It filters roles via `hiddenRoles` (default hides `system` and `tool`), windows visible rows with `maxRenderedMessages`, renders edit/regenerate/delete/copy/feedback controls, typing state, retry errors, custom `renderMessage`, and `ToolCallBlock` for visible tool messages. Accepts an optional `palette` prop applied as `--chorus-*` CSS variables on its root — see the `ChorusTheme` theming model below.

Helper map:

- `chat-window/types.ts` — public `ChatWindowProps`, `RenderErrorContext`, `RenderMessageRootProps`, and `RenderMessageContext` contracts re-exported by `ChatWindow.tsx`.
- `chat-window/activityKey.ts` — `stringActivityKey` plus attachment/message/visible activity fingerprints for auto-scroll and unread detection.
- `chat-window/messageWindowing.ts` — deprecated `showSystemMessages`/`hiddenRoles` resolution, visible-message filtering, and `maxRenderedMessages` normalization/windowing.
- `chat-window/MessageList.tsx` — visible message mapping, `renderMessage` context/slot handling, default tool/message rows, and action/copy/feedback wiring.
- `chat-window/messageRenderBuilders.tsx` — `buildMessageDefaultRender` (tool vs `MessageRow` default slot) and `buildMessageRenderActions` (the `MessageRenderActions` object) for one message.
- `chat-window/TranscriptStatusRows.tsx` — custom/default empty state, typing indicator, error row, and jump-to-bottom button.
- `chat-window/useAutoScroll.ts` — scroll container ref, near-bottom tracking, unread/jump-to-bottom state, and imperative scroll-to-bottom behavior.
- `chat-window/feedback.ts` — per-message feedback override state and cleanup as messages leave the transcript.
- `chat-window/rendering.tsx` — default suggested-prompt UI and `renderMessage` root-prop attachment.

## `MessageRow`

Default transcript row orchestrator. The facade preserves the public exports used by `ChatWindow`, `index.ts`, `headless.ts`, and direct subpath imports while delegating presentation, edit state, and action behavior to focused modules.

Submodule map:

- `message-row/types.ts` — shared `MessageBubbleSlots`, `MessageMarkdownProps`, `MessageCopyResult`, and `MessageRenderActions` contracts.
- `message-row/feedback.ts` — `GetMessageFeedback`, metadata feedback extraction, validation, and initial-feedback resolution.
- `message-row/renderState.tsx` — render-state context/provider and `useActionEditing` for coordinating custom `MessageBubble` + default action controls.
- `message-row/speaker.tsx` — screen-reader speaker labels and role-to-label helper.
- `message-row/bubble.tsx` — attachments, reasoning details, bubble layout, and exported `MessageBubble`.
- `message-row/InlineMessageEditor.tsx` — inline textarea editor and save/cancel controls.
- `message-row/actions.tsx` — copy/regenerate/edit/delete/feedback buttons, copy-failed timer state, and copy action creation.

## `ChatInput`

Textarea plus send/stop button and optional file attachment UI (`accept` enables attach). Enter sends, Shift+Enter inserts a newline, and attached files are read as data URLs by default. `onSend` may return `false` to veto a send; attachment chips and textarea height are only cleared after an accepted send. Accepts an optional `palette` prop applied as `--chorus-*` CSS variables on its root — see the `ChorusTheme` theming model below.

Composer and attachment internals live in `components/chat-input/`; see `components/chat-input/CLAUDE.md` for the full submodule map. Key split points:

- `types.ts` preserves the public `ChatInputProps` and `RenderAttachmentErrorContext` contracts re-exported by `ChatInput.tsx`.
- `useComposerTextarea.ts`, `useChatInputSend.ts`, and `useFileIngestionHandlers.ts` own textarea/focus, send acceptance/reset, and picker/paste/drag/drop dispatch respectively.
- `useAttachmentQueue.ts` remains the facade for `ChatInput`, delegating validation to `attachmentValidation.ts`, pending read/upload work to `attachmentPendingWork.ts`, and drag depth to `useAttachmentDragState.ts`.

## `Markdown`

Public facade only. Internals live in `components/markdown/`: `marked.ts` owns private Marked instances and safe renderer setup, `sanitize.ts` owns DOMPurify/custom sanitizer resolution plus SSR URL/entity safety, `codeBlockChrome.ts` wraps `<pre><code>` blocks, `useCodeCopy.ts` handles delegated copy feedback, and `highlight.ts` triggers lazy highlight.js/theme loading. Finalized markdown normalizes incomplete fences, parses with a memoized parser config, sanitizes when possible (or uses the safe renderer when no sanitizer exists), then adds code-block chrome unless `headless`. While `streaming` is true it skips parsing/highlighting and renders React-escaped plain text with pre-wrap until finalization.

## `ChorusTheme`

Standalone wrapper that applies palette CSS variables via `styleVarsFromPalette`. It is not used as the `Chorus` root wrapper; `Chorus.tsx` merges palette variables directly into the root div `style` prop.

### Theming model (keep uniform)

Every exported root component themes the same way: it takes an optional `palette` prop and emits `--chorus-*` CSS variables onto its own root via `styleVarsFromPalette`. This holds for `Chorus`, `ChatWindow`, `ChatInput`, and `ConversationList`. `ChorusTheme` is the same mechanism without a component — a bare `<div>` carrying those variables — so it themes any subtree (including composed shells that mix the pieces).

Rules to preserve when touching theming:

- A new exported root component that renders chrome should accept `palette` and apply `styleVarsFromPalette` to its root. Do not add a per-component bespoke theming path.
- Apply the palette unconditionally — do **not** gate it on `headless`. `palette` is a host-supplied theme, not default styling. (`ConversationList` previously gated on `headless`; that was the inconsistency the unified model removed.)
- Precedence is the plain CSS cascade: `styleVarsFromPalette` only emits keys the palette actually defines, so the nearest ancestor that sets a given `--chorus-*` variable wins per variable. There is no JS-level merge between a component's own `palette` and an ancestor `<ChorusTheme>`/`<Chorus palette>`.

## `MessageBubble`

Exported from `ChatWindow.tsx` for use in `renderMessage` render-props and implemented in `message-row/bubble.tsx`. It wraps the default role class and bubble, renders `message.reasoning` as a details block, renders `message.attachments` (image previews or file names), passes text through `Markdown`, and renders a `ToolCallBlock` for `role: 'tool'` messages (with `message.text`, when present, shown above as a host summary). The built-in `MessageRow` uses the same renderer and adds edit/regenerate/delete/copy/feedback actions. So a host composing a custom shell can pass a `role: 'tool'` message to either exported component and still get its tool call — `ChatWindow`'s `messageRenderBuilders` tool branch is no longer the only path that renders one.

The reasoning details block starts collapsed, but is auto-opened while a reasoning-only turn is still streaming so chain-of-thought is visible as it arrives. That auto-open is only a starting suggestion: `MessageReasoning` tracks the reader's own toggle in state, so a reader who collapses the chain-of-thought mid-stream keeps it collapsed as further chunks arrive (a controlled `open={true}` would re-force it open each chunk).

## `ToolCallBlock`

Collapsible block for tool call messages. It shows the tool name and expands to pretty-printed input/output when present. A call with neither input nor output has nothing to expand, so instead of a dead disabled button it renders a static status row: `running` while the `streaming` prop is true (the turn is still in flight), `empty` once it has settled. `MessageList` only passes `streaming` for tool rows in the in-flight turn — a session is streaming (`streamingMessageId != null`) **and** the row trails the last user message — so an older, finished empty-bodied tool call keeps showing `empty` while an unrelated later turn streams.
