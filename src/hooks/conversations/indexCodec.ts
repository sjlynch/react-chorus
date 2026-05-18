import type { Message, StorageAdapter } from '../../types';
import type { ConversationStorageError, ConversationSummary, RenameFromFirstMessageOptions } from './types';
import { warnInDev } from '../../utils/warnings';
import { createConversationStorageError } from './storageErrors';

export const DEFAULT_FIRST_MESSAGE_TITLE_MAX_LENGTH = 48;

export interface ConversationIndexPayload {
  conversations: ConversationSummary[];
  activeId: string | null;
}

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

interface ConversationSummaryCandidate {
  id: string;
  title: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  pinned?: unknown;
  pristine?: unknown;
}

interface SanitizedConversation {
  conversation: ConversationSummary;
  migrated: boolean;
}

interface ParsedConversationIndex extends ConversationIndexPayload {
  shouldPersist: boolean;
}

export interface ParsedConversationState {
  state: ConversationsState;
  error: ConversationStorageError | null;
  shouldPersist: boolean;
}

export function normalizeTimestamp(value: Date | string | number): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  return value;
}

export function normalizeTitle(title: string | undefined, fallback: string) {
  const trimmed = title?.trim();
  return trimmed || fallback;
}

export function getTimestamp(now: () => Date | string | number) {
  return normalizeTimestamp(now());
}

function isConversationSummary(value: unknown): value is ConversationSummaryCandidate {
  return typeof value === 'object'
    && value !== null
    && typeof (value as ConversationSummaryCandidate).id === 'string'
    && typeof (value as ConversationSummaryCandidate).title === 'string';
}

function warnTimestampBackfill(id: string, fields: string[]) {
  warnInDev(`[Chorus] Migrated conversation index entry "${id}" by backfilling missing ${fields.join(' and ')}.`);
}

function sanitizeConversation(
  value: ConversationSummaryCandidate,
  defaultTitle: string,
  now: () => Date | string | number,
): SanitizedConversation {
  const hasCreatedAt = typeof value.createdAt === 'string';
  const hasUpdatedAt = typeof value.updatedAt === 'string';
  const timestamp = hasCreatedAt || hasUpdatedAt ? null : getTimestamp(now);
  const createdAt = hasCreatedAt
    ? value.createdAt as string
    : hasUpdatedAt
      ? value.updatedAt as string
      : timestamp as string;
  const updatedAt = hasUpdatedAt
    ? value.updatedAt as string
    : hasCreatedAt
      ? value.createdAt as string
      : timestamp as string;
  const missingTimestampFields = [
    ...(!hasCreatedAt ? ['createdAt'] : []),
    ...(!hasUpdatedAt ? ['updatedAt'] : []),
  ];

  if (missingTimestampFields.length > 0) warnTimestampBackfill(value.id, missingTimestampFields);

  const hasPristine = typeof value.pristine === 'boolean';
  const pristine = hasPristine ? value.pristine as boolean : value.title.trim() === defaultTitle.trim();

  return {
    conversation: {
      id: value.id,
      title: value.title,
      createdAt,
      updatedAt,
      ...(value.pinned !== undefined ? { pinned: Boolean(value.pinned) } : {}),
      pristine,
    },
    migrated: missingTimestampFields.length > 0 || !hasPristine,
  };
}

export function chooseActiveId(conversations: ConversationSummary[], preferredId?: string | null) {
  if (preferredId && conversations.some(conversation => conversation.id === preferredId)) return preferredId;
  return conversations[0]?.id ?? null;
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

export function emptyState(): ConversationsState {
  return { conversations: [], activeId: null, loaded: true };
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

export function titleFromFirstMessage(
  messages: Pick<Message, 'role' | 'text'>[],
  { fallbackTitle, maxLength = DEFAULT_FIRST_MESSAGE_TITLE_MAX_LENGTH }: Pick<RenameFromFirstMessageOptions, 'fallbackTitle' | 'maxLength'> = {},
) {
  const firstUserText = messages.find(message => message.role === 'user' && (message.text ?? '').trim().length > 0)?.text;
  const normalized = (firstUserText ?? fallbackTitle ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const limit = Math.max(1, maxLength);
  if (normalized.length <= limit) return normalized;
  if (limit === 1) return '…';
  return `${normalized.slice(0, limit - 1).trimEnd()}…`;
}
