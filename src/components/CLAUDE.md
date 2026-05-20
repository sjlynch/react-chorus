# components guide

## `ChatWindow`

Message list and auto-scroll container. It filters roles via `hiddenRoles` (default hides `system` and `tool`), windows visible rows with `maxRenderedMessages`, renders edit/regenerate/delete/copy/feedback controls, typing state, retry errors, custom `renderMessage`, and `ToolCallBlock` for visible tool messages.

Helper map:

- `chat-window/types.ts` — public `ChatWindowProps`, `RenderErrorContext`, `RenderMessageRootProps`, and `RenderMessageContext` contracts re-exported by `ChatWindow.tsx`.
- `chat-window/activityKey.ts` — `stringActivityKey` plus attachment/message/visible activity fingerprints for auto-scroll and unread detection.
- `chat-window/messageWindowing.ts` — deprecated `showSystemMessages`/`hiddenRoles` resolution, visible-message filtering, and `maxRenderedMessages` normalization/windowing.
- `chat-window/MessageList.tsx` — visible message mapping, `renderMessage` context/slot handling, default tool/message rows, and action/copy/feedback wiring.
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

Textarea plus send/stop button and optional file attachment UI (`accept` enables attach). Enter sends, Shift+Enter inserts a newline, and attached files are read as data URLs by default. `onSend` may return `false` to veto a send; attachment chips and textarea height are only cleared after an accepted send.

Composer and attachment internals live in `components/chat-input/`; see `components/chat-input/CLAUDE.md` for the full submodule map. Key split points:

- `types.ts` preserves the public `ChatInputProps` and `RenderAttachmentErrorContext` contracts re-exported by `ChatInput.tsx`.
- `useComposerTextarea.ts`, `useChatInputSend.ts`, and `useFileIngestionHandlers.ts` own textarea/focus, send acceptance/reset, and picker/paste/drag/drop dispatch respectively.
- `useAttachmentQueue.ts` remains the facade for `ChatInput`, delegating validation to `attachmentValidation.ts`, pending read/upload work to `attachmentPendingWork.ts`, and drag depth to `useAttachmentDragState.ts`.

## `Markdown`

Public facade only. Internals live in `components/markdown/`: `marked.ts` owns private Marked instances and safe renderer setup, `sanitize.ts` owns DOMPurify/custom sanitizer resolution plus SSR URL/entity safety, `codeBlockChrome.ts` wraps `<pre><code>` blocks, `useCodeCopy.ts` handles delegated copy feedback, and `highlight.ts` triggers lazy highlight.js/theme loading. Finalized markdown normalizes incomplete fences, parses with a memoized parser config, sanitizes when possible (or uses the safe renderer when no sanitizer exists), then adds code-block chrome unless `headless`. While `streaming` is true it skips parsing/highlighting and renders React-escaped plain text with pre-wrap until finalization.

## `ChorusTheme`

Standalone wrapper that applies palette CSS variables via `styleVarsFromPalette`. It is not used as the `Chorus` root wrapper; `Chorus.tsx` merges palette variables directly into the root div `style` prop.

## `MessageBubble`

Exported from `ChatWindow.tsx` for use in `renderMessage` render-props and implemented in `message-row/bubble.tsx`. It wraps the default role class and bubble, renders `message.reasoning` as a collapsed details block, renders `message.attachments` (image previews or file names), and passes text through `Markdown`. The built-in `MessageRow` uses the same attachment/reasoning renderer and adds edit/regenerate/delete/copy/feedback actions.

## `ToolCallBlock`

Collapsible block for tool call messages. It shows the tool name and expands to pretty-printed input/output when present. A call with neither input nor output has nothing to expand, so instead of a dead disabled button it renders a static status row: `running` while the `streaming` prop is true (the turn is still in flight), `empty` once it has settled. `MessageList` passes `streaming` derived from session activity (`streamingMessageId != null`).
