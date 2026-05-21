import type { ConversationSummary } from './types';

export function chooseActiveId(conversations: ConversationSummary[], preferredId?: string | null) {
  if (preferredId && conversations.some(conversation => conversation.id === preferredId)) return preferredId;
  return conversations[0]?.id ?? null;
}
