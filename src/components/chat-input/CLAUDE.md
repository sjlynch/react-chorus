# chat-input guide

`ChatInput.tsx` is the public facade. Keep public props/types stable there by re-exporting the contracts from this folder.

Submodule map:

- `types.ts` — `ChatInputProps` and `RenderAttachmentErrorContext` public contracts.
- `useComposerTextarea.ts` — textarea refs, autoresize (`MAX_COMPOSER_TEXTAREA_HEIGHT`), reset height, and imperative focus wiring.
- `useChatInputSend.ts` — send acceptance semantics, including `onSend` returning `false` or resolving `false` to veto clearing.
- `useFileIngestionHandlers.ts` — picker/paste/drag/drop dispatch; host handlers run first and built-in ingestion only runs when the event was not default-prevented.
- `AttachmentErrorRegion.tsx` — default accessible attachment-error surface.
- `AttachmentChips.tsx` — chip/thumbnail/spinner/remove-button and image alt-text controls.
- `useAttachmentQueue.ts` — facade for attachment state consumed by `ChatInput`.
- `attachmentValidation.ts` — accept matching, size/count validation, localized error messages, and `formatBytes`.
- `attachmentPendingWork.ts` — pending read/upload placeholders, abort-controller bookkeeping, chip replacement/removal, and live announcements.
- `useAttachmentDragState.ts` — drag-depth state plus window dragend/blur cleanup.
- `attachmentUtils.ts` — pending metadata helpers, FileReader/default upload conversion, file-list, and DataTransfer helpers.
