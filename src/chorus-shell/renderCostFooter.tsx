import type React from 'react';
import { MessageCostChip } from '../components/message-row/cost';
import { heuristicTokenCount } from '../utils/tokenize';
import type { Message } from '../types';
import type { ConversationCost } from '../utils/cost';

export interface BuildCostFooterRendererArgs {
  cost: ConversationCost;
  streamingMessageId: string | null;
  defaultModelId?: string;
}

/**
 * Builds the `renderMessageFooter` closure used by `useChorusShellRuntime`
 * when `<Chorus showCost>` is enabled. Lives in its own `.tsx` module so the
 * runtime helper file stays `.ts` (no JSX), matching the rest of `chorus-shell/`.
 *
 * Two render paths per assistant message:
 *   1. The post-`done` chip — uses the recorded `cost.byMessageId` entry.
 *   2. The live (pre-`done`) chip — used for the streaming bubble before any
 *      `usage` payload has arrived. Renders a heuristic `~N tok` approximation
 *      from the streamed text and marks it `approximate` so the tooltip
 *      explains the imprecision.
 */
export function buildCostFooterRenderer<TMeta>({
  cost,
  streamingMessageId,
  defaultModelId,
}: BuildCostFooterRendererArgs): (message: Message<TMeta>) => React.ReactNode {
  return (message: Message<TMeta>) => {
    if (message.role !== 'assistant') return null;
    const recorded = cost.byMessageId[message.id];
    if (recorded) return <MessageCostChip cost={recorded} />;
    if (message.id === streamingMessageId) {
      const tokens = heuristicTokenCount(message.text ?? '');
      if (tokens === 0) return null;
      return (
        <MessageCostChip
          cost={{ usd: 0, tokens, modelId: defaultModelId }}
          approximate
          title="Live estimate — usage not finalized yet"
        />
      );
    }
    return null;
  };
}
