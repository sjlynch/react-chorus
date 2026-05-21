import {
  geminiBlockedMessage,
  isBlockingFinishReason,
  isDoneFinishReason,
  isUnspecifiedFinishReason,
} from '../geminiSemantics';
import type { ConnectorResult } from '../types';

export function applyFinishReason(
  result: ConnectorResult,
  finishReason: unknown,
  worstSafetyCategory: string | undefined,
  obj: unknown,
): ConnectorResult {
  if (isUnspecifiedFinishReason(finishReason)) {
    return {
      ...result,
      error: 'Gemini response ended with an unspecified finish reason',
      errorPayload: obj,
    };
  }
  if (isBlockingFinishReason(finishReason)) {
    return {
      ...result,
      error: geminiBlockedMessage(finishReason, Boolean(result.text || result.reasoning), worstSafetyCategory),
      errorPayload: obj,
    };
  }
  if (isDoneFinishReason(finishReason)) {
    result.done = true;
    if (finishReason === 'MAX_TOKENS') {
      result.metadata = { ...(result.metadata ?? {}), finishReason };
      // Only set the truncation warning when none is present yet, so a chunk
      // that carries both an unsupported part and `finishReason: MAX_TOKENS`
      // keeps the earlier `unsupported-part` warning instead of clobbering it
      // — consistent with the defensive guard in candidates.ts.
      if (!result.warning) {
        result.warning = {
          code: 'truncated',
          message: 'Gemini response truncated by maxOutputTokens',
          payload: obj,
        };
      }
    }
  }
  return result;
}
