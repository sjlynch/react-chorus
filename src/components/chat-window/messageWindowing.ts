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

export function windowVisibleMessages<TMeta = Record<string, unknown>>(visibleMessages: Message<TMeta>[], normalizedMaxRenderedMessages: number | null) {
  if (normalizedMaxRenderedMessages === null) return visibleMessages;
  if (normalizedMaxRenderedMessages === 0) return [];
  return visibleMessages.slice(-normalizedMaxRenderedMessages);
}
