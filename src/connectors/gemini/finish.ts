import {
  geminiBlockedMessage,
  isBlockingFinishReason,
  isDoneFinishReason,
  isUnspecifiedFinishReason,
} from '../geminiSemantics';
import type { ConnectorResult } from '../types';
import { addWarning } from './result';

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
      // Append the truncation warning rather than overwrite: a chunk that
      // carries both an unsupported part and `finishReason: MAX_TOKENS` must
      // surface *both* diagnostics. Truncation is the more actionable signal,
      // so it must never be dropped just because an earlier warning exists.
      addWarning(result, {
        code: 'truncated',
        message: 'Gemini response truncated by maxOutputTokens',
        payload: obj,
      });
    }
  }
  return result;
}
