import type { Message } from '../../types';

/**
 * Reserved message id for the synthetic `system` message that
 * {@link historyWithSystemPrompt} prepends to transport request history from
 * the `systemPrompt` prop.
 *
 * This id is reserved by Chorus: a host-authored message must not use it, or
 * the two will collide. The value is intentionally stable (not per-request) so
 * request mappers and tests can recognize the Chorus-injected system message;
 * connectors/request mappers that need to distinguish it from a host-authored
 * `system` message should match on this id.
 */
export const RESERVED_SYSTEM_PROMPT_ID = 'chorus-system-prompt';

export function historyWithSystemPrompt<TMeta>(
  history: Message<TMeta>[],
  systemPrompt: string | undefined,
): Message<TMeta>[] {
  return systemPrompt
    ? [{ id: RESERVED_SYSTEM_PROMPT_ID, role: 'system' as const, text: systemPrompt }, ...history]
    : history;
}
