import type { ConversationSummary } from '../../hooks/useConversations';

export function sortedConversations(conversations: ConversationSummary[]) {
  return conversations
    .map((conversation, index) => ({ conversation, index }))
    .sort((a, b) => {
      const pinnedDelta = Number(Boolean(b.conversation.pinned)) - Number(Boolean(a.conversation.pinned));
      if (pinnedDelta !== 0) return pinnedDelta;

      const aTime = Date.parse(a.conversation.updatedAt);
      const bTime = Date.parse(b.conversation.updatedAt);
      const recencyDelta = (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
      if (recencyDelta !== 0) return recencyDelta;

      return a.index - b.index;
    })
    .map(({ conversation }) => conversation);
}
