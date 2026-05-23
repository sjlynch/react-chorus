import type { ConnectorResult } from '../types';
import { extractUsage } from '../usage';

export function handleMessageDelta(obj: Record<string, unknown>): ConnectorResult | null {
  const delta = obj.delta && typeof obj.delta === 'object' ? obj.delta as Record<string, unknown> : null;
  const stopReason = typeof delta?.stop_reason === 'string' ? delta.stop_reason : null;
  // `message_delta` carries the cumulative `usage.output_tokens` count.
  const usage = extractUsage(obj.usage);

  if (!stopReason) {
    // A `message_delta` with no stop_reason still updates the running
    // output-token count; surface usage alone rather than dropping it.
    return usage ? { metadata: { usage } } : null;
  }

  const stopSequence = typeof delta?.stop_sequence === 'string' ? delta.stop_sequence : null;
  const metadata: Record<string, unknown> = { stopReason };
  if (stopSequence) metadata.stopSequence = stopSequence;
  if (usage) metadata.usage = usage;

  if (stopReason === 'refusal') {
    return {
      error: 'Anthropic model refused to respond',
      errorPayload: obj,
      metadata,
    };
  }

  if (stopReason === 'max_tokens') {
    return {
      metadata,
      warning: {
        code: 'truncated',
        message: 'Anthropic response truncated by max_tokens',
        payload: obj,
      },
    };
  }

  // end_turn, stop_sequence, tool_use are all normal terminations; surface stop_reason as
  // metadata so consumers can persist or display it without treating it as a problem.
  return { metadata };
}
