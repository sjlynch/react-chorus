import { warnInDev } from '../../utils/warnings';
import type { ConversationSummary } from './types';
import { getTimestamp } from './timestamp';

interface ConversationSummaryCandidate {
  id: string;
  title: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  pinned?: unknown;
  pristine?: unknown;
}

export interface SanitizedConversation {
  conversation: ConversationSummary;
  migrated: boolean;
}

export function isConversationSummary(value: unknown): value is ConversationSummaryCandidate {
  return typeof value === 'object'
    && value !== null
    && typeof (value as ConversationSummaryCandidate).id === 'string'
    && typeof (value as ConversationSummaryCandidate).title === 'string';
}

function warnTimestampBackfill(id: string, fields: string[]) {
  warnInDev(`[Chorus] Migrated conversation index entry "${id}" by backfilling missing ${fields.join(' and ')}.`);
}

export function sanitizeConversation(
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
