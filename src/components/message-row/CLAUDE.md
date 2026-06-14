# message-row internals

`../MessageRow.tsx` is the public facade — the default transcript row orchestrator. Keep the public exports it preserves for `ChatWindow`, `index.ts`, `headless.ts`, and direct subpath imports stable; implementation details live in this folder.

Module map:

- `types.ts` — shared contracts: `MessageBubbleSlots`, `MessageMarkdownProps`, `MessageTimestampFormatter`, `MessageCopyResult`, and `MessageRenderActions`.
- `bubble.tsx` — composes the message content layout: role class, bubble container, text through `Markdown`, and a `ToolCallBlock` for `role: 'tool'` messages; exports `MessageBubble` and `MessageBubbleLayout`. Each sub-piece (attachments, reasoning, sources, timestamp) lives in its own file imported here.
- `attachments.tsx` — `MessageAttachments` (image previews or file-name chips) and the `resolveAttachmentImageAlt` helper.
- `reasoning.tsx` — `MessageReasoning` + `MessageReasoningProps`. Reader-collapsible even while streaming auto-opens it; the auto-open hint is latched so the panel stays open after answer text arrives until the reader collapses it.
- `sources.tsx` — `MessageSources` + `MessageSourcesProps` (citation list rendered below the bubble).
- `timestamp.tsx` — `MessageTimestamp` + `MessageTimestampProps` (`<time>` element rendered when `showTimestamp` is on).
- `actions.tsx` — owns the copy/regenerate/edit/delete/feedback action controls, composing `useCopyFeedback` for copy-failure state, and copy action creation.
- `useCopyFeedback.ts` — the copy-failure timer state machine extracted from `MessageActions`: owns `copyFailed`, the `COPY_FEEDBACK_DURATION_MS` reset timeout (cleared on retrigger and unmount), and the derived `copyLabel`.
- `InlineMessageEditor.tsx` — inline `<textarea>` editor with save/cancel controls; resizes via `chat-input/useTextareaAutosize` so it matches the composer.
- `renderState.tsx` — `MessageRenderStateContext`/provider and `useActionEditing`, which link the default action controls' edit state to the row when a host swaps in a custom `MessageBubble`; also `useReturnFocusAfterEditing` for focus return on cancel.
- `speaker.tsx` — screen-reader speaker labels (`MessageSpeakerLabel`, `getMessageSpeakerLabel`, `resolveMessageSpeakerLabel`) plus the visible `MessageSpeakerBadge` rendered above the bubble when `message.speaker` is set. The badge is `aria-hidden` because `MessageSpeakerLabel` already announces the speaker — keeping both visible would duplicate the name in screen readers. The visible name renders unconditionally when `speaker` is present; only the avatar `<img>` is gated by `showSpeakerAvatars`.
- `feedback.ts` — low-level feedback helpers: the `isMessageFeedback` type guard, `getMetadataFeedback` metadata extraction, and `getInitialMessageFeedback` resolution.
- `formatTimestamp.ts` — `defaultFormatMessageTimestamp`, the default per-message timestamp formatter.
- `ToolApprovalCard.tsx` — three-button approval card ("Allow once / Allow always / Deny") rendered in place of the `ToolCallBlock` while `toolCall.approval === 'pending'`. Resolves decisions through `approvalContext.ts`, which the shell wires up to the `toolPolicyStore`. The card is decoupled from the policy store; a host composing a custom shell can render `ToolApprovalCard` and supply its own `ToolApprovalContext.Provider` value to integrate a non-built-in approval store.
- `approvalContext.tsx` — `ToolApprovalContext` carrying the `respond(toolCallId, toolName, decision)` callback. The `<Chorus>` shell provides the value (`useChorusShellRuntime`); `ToolApprovalCard` reads it. Missing context = no-op clicks (e.g. when `ToolApprovalCard` is rendered standalone in tests/storybook).

## Two `formatTimestamp.ts` files

`message-row/formatTimestamp.ts` formats with `timeStyle: 'short'` only — message rows show the time of day. `conversation-list/formatTimestamp.ts` adds `dateStyle: 'medium'` because a conversation list spans many days and needs the full date + time. Both share the same invalid-date echo and `Intl`-failure fallback shape; keep them as separate per-surface defaults rather than merging.

## `feedback.ts` vs `chat-window/feedback.ts`

This file is stateless — pure type guards and per-message metadata extraction. `chat-window/feedback.ts` is the stateful, transcript-level layer: `useMessageFeedbackState` consumes `getInitialMessageFeedback` here to seed selections, then tracks local overrides, host-driven changes, and cleanup as messages leave the transcript. Keep resolution logic here and coordination there.
