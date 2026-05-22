import type { Message, Role } from '../../types';

export const DEFAULT_HIDDEN_ROLES: readonly Role[] = ['system', 'tool'];
export const NO_HIDDEN_ROLES: readonly Role[] = [];

export function getEffectiveHiddenRoles(hiddenRoles: Role[] | undefined, showSystemMessages: boolean | undefined) {
  return hiddenRoles ?? (showSystemMessages ? NO_HIDDEN_ROLES : DEFAULT_HIDDEN_ROLES);
}

export function createHiddenRoleSet(hiddenRoles: readonly Role[]) {
  return new Set<Role>(hiddenRoles);
}

export function filterVisibleMessages<TMeta = Record<string, unknown>>(messages: Message<TMeta>[], hiddenRoleSet: ReadonlySet<Role>) {
  return messages.filter(message => !hiddenRoleSet.has(message.role));
}

export function normalizeMaxRenderedMessages(maxRenderedMessages: number | undefined) {
  if (maxRenderedMessages === undefined) return null;
  if (!Number.isFinite(maxRenderedMessages)) return null;
  return Math.max(0, Math.floor(maxRenderedMessages));
}

export function windowVisibleMessages<TMeta = Record<string, unknown>>(
  visibleMessages: Message<TMeta>[],
  normalizedMaxRenderedMessages: number | null,
  streamingMessageId?: string | null,
) {
  if (normalizedMaxRenderedMessages === null) return visibleMessages;
  const windowed = normalizedMaxRenderedMessages === 0 ? [] : visibleMessages.slice(-normalizedMaxRenderedMessages);
  if (streamingMessageId == null || windowed.some(message => message.id === streamingMessageId)) {
    return windowed;
  }
  // The streaming message fell outside the trailing window — a host appended
  // rows after it, or maxRenderedMessages is very low. Force-include it (it
  // precedes the trailing slice, so it stays first) so its partial text keeps
  // rendering and Markdown stays in streaming-plain-text mode while active.
  const streamingMessage = visibleMessages.find(message => message.id === streamingMessageId);
  if (streamingMessage === undefined) return windowed;
  return [streamingMessage, ...windowed];
}
