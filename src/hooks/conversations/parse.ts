import type { ConversationStorageError, ConversationSummary } from './types';
import { createConversationStorageError } from './storageErrors';
import { chooseActiveId } from './activeId';
import { isConversationSummary, sanitizeConversation } from './sanitize';
import { emptyState, type ConversationsState } from './state';

export interface ConversationIndexPayload {
  conversations: ConversationSummary[];
  activeId: string | null;
}

interface ParsedConversationIndex extends ConversationIndexPayload {
  shouldPersist: boolean;
}

export interface ParsedConversationState {
  state: ConversationsState;
  error: ConversationStorageError | null;
  shouldPersist: boolean;
}

export function parseConversationIndex(
  raw: string | null,
  preferredActiveId: string | null | undefined,
  defaultTitle: string,
  now: () => Date | string | number,
): ParsedConversationIndex {
  if (!raw) return { conversations: [], activeId: null, shouldPersist: false };

  const parsed = JSON.parse(raw) as unknown;
  const source = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { conversations?: unknown }).conversations)
      ? (parsed as { conversations: unknown[] }).conversations
      : [];
  const sanitized = source.filter(isConversationSummary).map(conversation => sanitizeConversation(conversation, defaultTitle, now));
  const conversations = sanitized.map(result => result.conversation);
  const storedActiveId = typeof parsed === 'object'
    && parsed !== null
    && typeof (parsed as { activeId?: unknown }).activeId === 'string'
    ? (parsed as { activeId: string }).activeId
    : null;

  return {
    conversations,
    activeId: chooseActiveId(conversations, preferredActiveId ?? storedActiveId),
    shouldPersist: sanitized.some(result => result.migrated),
  };
}

export function serializeConversationIndex(conversations: ConversationSummary[], activeId: string | null) {
  return JSON.stringify({ conversations, activeId });
}

export function stateFromRaw(
  raw: string | null,
  preferredActiveId: string | null | undefined,
  indexKey: string,
  defaultTitle: string,
  now: () => Date | string | number,
): ParsedConversationState {
  try {
    const index = parseConversationIndex(raw, preferredActiveId, defaultTitle, now);
    return {
      state: { conversations: index.conversations, activeId: index.activeId, loaded: true },
      error: null,
      shouldPersist: index.shouldPersist,
    };
  } catch (error) {
    return {
      state: emptyState(),
      error: createConversationStorageError(indexKey, 'read', error),
      shouldPersist: false,
    };
  }
}
