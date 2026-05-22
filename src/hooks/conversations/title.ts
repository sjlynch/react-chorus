import type { Message } from '../../types';
import type { RenameFromFirstMessageOptions } from './types';

export const DEFAULT_FIRST_MESSAGE_TITLE_MAX_LENGTH = 48;

/** Roles `titleFromFirstMessage` scans when `includeRoles` is not supplied. */
export const DEFAULT_TITLE_SOURCE_ROLES: Message['role'][] = ['user'];

export function normalizeTitle(title: string | undefined, fallback: string) {
  const trimmed = title?.trim();
  return trimmed || fallback;
}

export function titleFromFirstMessage(
  messages: Pick<Message, 'role' | 'text'>[],
  { fallbackTitle, maxLength = DEFAULT_FIRST_MESSAGE_TITLE_MAX_LENGTH, includeRoles }: Pick<RenameFromFirstMessageOptions, 'fallbackTitle' | 'maxLength' | 'includeRoles'> = {},
) {
  // Default to user messages: a conversation seeded with a system prompt + an
  // assistant greeting has no user text until the user replies. Callers wanting
  // to title such an assistant-first conversation pass `includeRoles`.
  const roles = includeRoles && includeRoles.length > 0 ? includeRoles : DEFAULT_TITLE_SOURCE_ROLES;
  const firstText = messages.find(message => roles.includes(message.role) && (message.text ?? '').trim().length > 0)?.text;
  const normalized = (firstText ?? fallbackTitle ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const limit = Math.max(1, maxLength);
  // Count and slice by code point, not UTF-16 code unit: `String.prototype.slice`
  // can cut an emoji / ZWJ sequence / CJK pair mid-surrogate-pair and leave a lone
  // surrogate that serializes to a replacement character (�) in the persisted
  // index. `Array.from` iterates code points, so a slice boundary never lands
  // inside a surrogate pair.
  const codePoints = Array.from(normalized);
  if (codePoints.length <= limit) return normalized;
  if (limit === 1) return '…';
  return `${codePoints.slice(0, limit - 1).join('').trimEnd()}…`;
}
