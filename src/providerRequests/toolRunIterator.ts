import type { Message, ToolMessage } from '../types';

/**
 * Walks a history and folds contiguous runs of `role === 'tool'` messages into a single
 * `onToolRun` callback. All providers share this invariant: tool messages form contiguous
 * runs that fold into one assistant tool_use + one tool_result block (or the provider's
 * equivalent). Non-tool messages are dispatched one-by-one via `onMessage`.
 */
export function forEachHistoryEntry<TMeta>(
  history: Message<TMeta>[],
  visitor: {
    onMessage: (message: Message<TMeta>) => void;
    onToolRun: (run: ToolMessage<TMeta>[]) => void;
  },
): void {
  for (let i = 0; i < history.length; i += 1) {
    const message = history[i];
    if (!message) continue;
    if (message.role !== 'tool') {
      visitor.onMessage(message);
      continue;
    }

    const run: ToolMessage<TMeta>[] = [];
    while (i < history.length) {
      const next = history[i];
      if (!next || next.role !== 'tool') break;
      run.push(next);
      i += 1;
    }
    i -= 1;

    visitor.onToolRun(run);
  }
}
