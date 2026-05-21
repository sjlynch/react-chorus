import type { StorageAdapter } from '../../types';
import type { ConversationSummary } from './types';

export interface ConversationsState {
  conversations: ConversationSummary[];
  activeId: string | null;
  loaded: boolean;
}

export interface PendingConversationCreate {
  storage: StorageAdapter;
  indexKey: string;
  conversation: ConversationSummary;
}

export function emptyState(): ConversationsState {
  return { conversations: [], activeId: null, loaded: true };
}
