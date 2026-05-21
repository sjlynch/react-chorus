# conversation-list internals

`ConversationList.tsx` is the public facade. Keep public prop/type exports stable there; the actual public contracts live in `types.ts` and are re-exported by the facade.

Module map:

- `ConversationListItem.tsx` — per-row DOM, ARIA, action buttons, rename form (inline validation message + `maxLength`), and timestamp rendering. The row root carries `data-conversation-id` so the facade can locate it for focus restoration. Rename-form state comes from `renameContext.ts` via `useConversationRenameContext`, not props; the row derives its own `editing` flag from `conversation.id === editingId`.
- `renameContext.ts` — `ConversationRenameContext` (provider + `useConversationRenameContext` hook) carrying the `useConversationRename` state for the single editing row. `ConversationList` provides it once around the list so the per-row props stay limited to conversation data, selection, and delete handling. `restoreFocusId`/`clearRestoreFocus` deliberately stay off the context — they drive the facade's focus effects and no row reads them.
- `types.ts` — public `ConversationListProps`, `ConfirmDeleteConversation`, and delete-confirmation context types.
- `sorting.ts` — pinned/recency/stable-input-order sorting.
- `classes.ts` — conversation row class-name composition.
- `formatTimestamp.ts` — default timestamp formatting with invalid-date and `Intl` fallback behavior.
- `useConversationRename.ts` — rename draft state, input focus/select behavior, Escape/cancel plumbing, the exported `CONVERSATION_RENAME_MAX_LENGTH` guard, empty/too-long draft validation, `restoreFocusId` (row trigger to re-focus when rename mode exits), and cleanup when the edited conversation disappears.
- `useDeleteConversationConfirmation.ts` — async delete confirmation, per-id pending state, and the `onConversationDeleted` hook the facade uses to restore focus + announce the delete.

`ConversationList.tsx` owns post-mutation focus management: it re-focuses the rename trigger after rename mode exits and moves focus to a sibling row's select control (or the list container) after a delete, and renders the polite `role="status"` live region that announces deletions.

`useDeleteConversationConfirmation.ts` keeps a local `isPromiseLike` helper instead of importing `utils/async`, whose chunk would couple this component to the assistant-session tree and shift the tracked ConversationList bundle-size numbers. Keep the bundle-isolation comment with any future `isPromiseLike` change. The dev-mode gate, by contrast, is the shared `isChorusDevMode` from `src/utils/devMode.ts` — a zero-dependency leaf that is safe to import directly.
