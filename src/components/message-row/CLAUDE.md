# message-row internals

`../MessageRow.tsx` is the public facade — the default transcript row orchestrator. Keep the public exports it preserves for `ChatWindow`, `index.ts`, `headless.ts`, and direct subpath imports stable; implementation details live in this folder.

Module map:

- `types.ts` — shared contracts: `MessageBubbleSlots`, `MessageMarkdownProps`, `MessageTimestampFormatter`, `MessageCopyResult`, and `MessageRenderActions`.
- `bubble.tsx` — renders message content: role class, bubble layout, attachments (image previews or file names), `reasoning` details block (reader-collapsible even while streaming auto-opens it; the auto-open hint is latched so the panel stays open after answer text arrives until the reader collapses it), text through `Markdown`, and a `ToolCallBlock` for `role: 'tool'` messages; exports `MessageBubble`.
- `actions.tsx` — owns the copy/regenerate/edit/delete/feedback action controls, composing `useCopyFeedback` for copy-failure state, and copy action creation.
- `useCopyFeedback.ts` — the copy-failure timer state machine extracted from `MessageActions`: owns `copyFailed`, the `COPY_FEEDBACK_DURATION_MS` reset timeout (cleared on retrigger and unmount), and the derived `copyLabel`.
- `InlineMessageEditor.tsx` — inline `<textarea>` editor with save/cancel controls; resizes via `chat-input/useTextareaAutosize` so it matches the composer.
- `renderState.tsx` — `MessageRenderStateContext`/provider and `useActionEditing`, which link the default action controls' edit state to the row when a host swaps in a custom `MessageBubble`; also `useReturnFocusAfterEditing` for focus return on cancel.
- `speaker.tsx` — screen-reader speaker labels and the role-to-label helper.
- `feedback.ts` — low-level feedback helpers: the `isMessageFeedback` type guard, `getMetadataFeedback` metadata extraction, and `getInitialMessageFeedback` resolution.
- `formatTimestamp.ts` — `defaultFormatMessageTimestamp`, the default per-message timestamp formatter.

## Two `formatTimestamp.ts` files

`message-row/formatTimestamp.ts` formats with `timeStyle: 'short'` only — message rows show the time of day. `conversation-list/formatTimestamp.ts` adds `dateStyle: 'medium'` because a conversation list spans many days and needs the full date + time. Both share the same invalid-date echo and `Intl`-failure fallback shape; keep them as separate per-surface defaults rather than merging.

## `feedback.ts` vs `chat-window/feedback.ts`

This file is stateless — pure type guards and per-message metadata extraction. `chat-window/feedback.ts` is the stateful, transcript-level layer: `useMessageFeedbackState` consumes `getInitialMessageFeedback` here to seed selections, then tracks local overrides, host-driven changes, and cleanup as messages leave the transcript. Keep resolution logic here and coordination there.
