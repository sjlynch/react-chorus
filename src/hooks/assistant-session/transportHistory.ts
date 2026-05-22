import type { Message } from '../../types';
import { RESERVED_SYSTEM_PROMPT_ID } from '../../reservedIds';

// `RESERVED_SYSTEM_PROMPT_ID` itself lives in the dependency-free `src/reservedIds.ts`
// leaf so the public `react-chorus/server` and `react-chorus/provider-requests`
// barrels can re-export it without dragging in this `chorus-session` hook chunk.
// Re-exported here so existing imports of the id from this module keep working.
export { RESERVED_SYSTEM_PROMPT_ID };

export function historyWithSystemPrompt<TMeta>(
  history: Message<TMeta>[],
  systemPrompt: string | undefined,
): Message<TMeta>[] {
  return systemPrompt
    ? [{ id: RESERVED_SYSTEM_PROMPT_ID, role: 'system' as const, text: systemPrompt }, ...history]
    : history;
}
