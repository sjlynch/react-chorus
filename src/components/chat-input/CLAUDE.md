# chat-input guide

`ChatInput.tsx` is the public facade. Keep public props/types stable there by re-exporting the contracts from this folder.

`ChatInput.tsx` itself is a thin composition: it runs the hooks below, derives the composer flags/labels, and renders three internal presentational sub-components (`AttachmentSection`, `ComposerInputRow`, `DropOverlayPortal`). Those sub-components are private — they are not exported from the public barrel and carry no public contract; keep their rendered DOM, class names, and attributes in step with the facade.

Submodule map:

- `types.ts` — `ChatInputProps` and `RenderAttachmentErrorContext` public contracts.
- `AttachmentSection.tsx` — attachment UI rendered above the input row: the `AttachmentChips`, the polite live-region status announcer span, and the attachment error surface (default `AttachmentErrorRegion`, a host `renderAttachmentError` node, or nothing when the host passed `null`).
- `ComposerInputRow.tsx` — the `chorus-input-row`: optional hidden file input + attach button, the textarea, and the send/stop button.
- `DropOverlayPortal.tsx` — the "Drop to attach" drag overlay; portals onto the surrounding `.chorus` surface when one exists (resolved once on mount) and otherwise renders inside the composer root.
- `useTextareaAutosize.ts` — shared `<textarea>` auto-grow hook (collapse-to-`auto` then cap at a max height; re-measures on every `value` change). Used by `useComposerTextarea` and by `message-row/InlineMessageEditor.tsx` so the composer and the inline editor resize identically. It lives here (not under `components/`) so it stays inside the `chat-input` bundle chunk; `InlineMessageEditor` reaching across for it does not pull a new chunk because `ChatWindow` already loads `chat-input`.
- `useComposerTextarea.ts` — textarea refs, autoresize via `useTextareaAutosize` (`MAX_COMPOSER_TEXTAREA_HEIGHT`), reset height, imperative focus wiring, IME `isComposingRef`, and the `composerGenerationRef` edit counter.
- `useChatInputSend.ts` — send acceptance semantics, including `onSend` returning `false` or resolving `false` to veto clearing; an async `onSend` whose `composerGenerationRef` changed before it resolves no longer clears the (re-typed) composer.
- `useFileIngestionHandlers.ts` — picker/paste/composer drag/drop dispatch; host handlers run first and built-in ingestion only runs when the event was not default-prevented.
- `useChatSurfaceFileDrop.ts` — native drag/drop listeners for the surrounding `.chorus` surface plus the DataTransfer-claiming helper; transcript drops are ingested when allowed and file drops are always default-prevented to avoid browser navigation.
- `AttachmentErrorRegion.tsx` — default accessible attachment-error surface.
- `AttachmentChips.tsx` — per-`QueuedAttachment` chip rendering for the pending/ready/failed states: thumbnail/spinner/failed-icon, the cancel-vs-remove X button, the failed-state Retry button, and image alt-text controls. Keyed on `uid`.
- `useAttachmentQueue.ts` — facade for attachment state consumed by `ChatInput`; owns the `QueuedAttachment[]` state and exposes `queuedAttachments` (for chips) plus `sendableAttachments` (resolved-only, for send). All of `removeAttachment`/`updateAttachmentAlt`/`retryAttachment` target a `uid`, never an array index.
- `attachmentValidation.ts` — accept matching, size/count validation, localized error messages, and `formatBytes`.
- `attachmentPendingWork.ts` — pending read/upload work keyed by `uid`: abort-controller bookkeeping, success → `ready` replacement, failure → in-place `failed` marking (the chip is kept so it can be retried), `retryAttachmentWork`, and live announcements.
- `useAttachmentDragState.ts` — drag-depth state plus window dragend/blur cleanup.
- `attachmentUtils.ts` — the `QueuedAttachment` model + stable `uid` factory, the `updateQueuedAttachment` by-uid updater, FileReader/default upload conversion, file-list, and DataTransfer helpers.
