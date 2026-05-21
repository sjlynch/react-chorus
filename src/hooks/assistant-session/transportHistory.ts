import type { Message } from '../../types';

export function historyWithSystemPrompt<TMeta>(
  history: Message<TMeta>[],
  systemPrompt: string | undefined,
): Message<TMeta>[] {
  return systemPrompt
    ? [{ id: 'chorus-system-prompt', role: 'system' as const, text: systemPrompt }, ...history]
    : history;
}
