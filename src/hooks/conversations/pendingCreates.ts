import type { ConversationsState, PendingConversationCreate } from './state';

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
