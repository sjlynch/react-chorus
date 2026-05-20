# chat-input guide

`ChatInput.tsx` is the public facade. Keep public props/types stable there by re-exporting the contracts from this folder.

Submodule map:

- `types.ts` — `ChatInputProps` and `RenderAttachmentErrorContext` public contracts.
- `useComposerTextarea.ts` — textarea refs, autoresize (`MAX_COMPOSER_TEXTAREA_HEIGHT`), reset height, imperative focus wiring, IME `isComposingRef`, and the `composerGenerationRef` edit counter.
- `useChatInputSend.ts` — send acceptance semantics, including `onSend` returning `false` or resolving `false` to veto clearing; an async `onSend` whose `composerGenerationRef` changed before it resolves no longer clears the (re-typed) composer.
- `useFileIngestionHandlers.ts` — picker/paste/drag/drop dispatch; host handlers run first and built-in ingestion only runs when the event was not default-prevented. Also wires native drag/drop listeners on the surrounding `.chorus` surface so transcript drops are ingested and never navigate the browser away.
- `AttachmentErrorRegion.tsx` — default accessible attachment-error surface.
- `AttachmentChips.tsx` — per-`QueuedAttachment` chip rendering for the pending/ready/failed states: thumbnail/spinner/failed-icon, the cancel-vs-remove X button, the failed-state Retry button, and image alt-text controls. Keyed on `uid`.
- `useAttachmentQueue.ts` — facade for attachment state consumed by `ChatInput`; owns the `QueuedAttachment[]` state and exposes `queuedAttachments` (for chips) plus `sendableAttachments` (resolved-only, for send). All of `removeAttachment`/`updateAttachmentAlt`/`retryAttachment` target a `uid`, never an array index.
- `attachmentValidation.ts` — accept matching, size/count validation, localized error messages, and `formatBytes`.
- `attachmentPendingWork.ts` — pending read/upload work keyed by `uid`: abort-controller bookkeeping, success → `ready` replacement, failure → in-place `failed` marking (the chip is kept so it can be retried), `retryAttachmentWork`, and live announcements.
- `useAttachmentDragState.ts` — drag-depth state plus window dragend/blur cleanup.
- `attachmentUtils.ts` — the `QueuedAttachment` model + stable `uid` factory, the `updateQueuedAttachment` by-uid updater, FileReader/default upload conversion, file-list, and DataTransfer helpers.
