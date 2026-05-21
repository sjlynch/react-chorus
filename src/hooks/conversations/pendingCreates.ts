import type { ConversationsState, PendingConversationCreate } from './state';

// Ordering hazard: a pre-load `createConversation` of id X is re-inserted here
// even if a concurrent tab/server sync deleted X from the index *after* the
// local create but *before* the async index read resolved. The pre-load create
// wins over that remote delete. The window is narrow and the create's
// `(storage, indexKey)` source is still matched upstream, so a delete on the
// same source is not detected. See "Known ordering hazards" in
// conversations/CLAUDE.md.
export function mergePendingCreates(state: ConversationsState, pendingCreates: PendingConversationCreate[]): ConversationsState {
  if (pendingCreates.length === 0) return state;

  const pendingConversations = pendingCreates.map(create => create.conversation);
  const pendingIds = new Set(pendingConversations.map(conversation => conversation.id));
  return {
    conversations: [
      ...pendingConversations.slice().reverse(),
      ...state.conversations.filter(conversation => !pendingIds.has(conversation.id)),
    ],
    activeId: pendingConversations[pendingConversations.length - 1]?.id ?? state.activeId,
    loaded: true,
  };
}
