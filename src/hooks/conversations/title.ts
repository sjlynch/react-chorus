import type { Message } from '../../types';
import type { RenameFromFirstMessageOptions } from './types';

export const DEFAULT_FIRST_MESSAGE_TITLE_MAX_LENGTH = 48;

export function normalizeTitle(title: string | undefined, fallback: string) {
  const trimmed = title?.trim();
  return trimmed || fallback;
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
