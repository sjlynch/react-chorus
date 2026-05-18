# conversation-list internals

`ConversationList.tsx` is the public facade. Keep public prop/type exports stable there; the actual public contracts live in `types.ts` and are re-exported by the facade.

Module map:

- `ConversationListItem.tsx` — per-row DOM, ARIA, action buttons, rename form, and timestamp rendering.
- `types.ts` — public `ConversationListProps`, `ConfirmDeleteConversation`, and delete-confirmation context types.
- `sorting.ts` — pinned/recency/stable-input-order sorting.
- `classes.ts` — conversation row class-name composition.
- `formatTimestamp.ts` — default timestamp formatting with invalid-date and `Intl` fallback behavior.
- `useConversationRename.ts` — rename draft state, input focus/select behavior, Escape/cancel plumbing, and cleanup when the edited conversation disappears.
- `useDeleteConversationConfirmation.ts` — async delete confirmation and per-id pending state.

`useDeleteConversationConfirmation.ts` intentionally duplicates small async/dev helpers instead of importing shared utilities. Importing `utils/async` or the shared dev-mode gate would couple this component to the assistant-session chunk and can change the tracked ConversationList bundle-size numbers. Keep the bundle-isolation comments with any future duplicate helper changes.
