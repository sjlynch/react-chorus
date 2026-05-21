import { findWorstSafetyCategory } from '../geminiSemantics';
import type { ConnectorResult } from '../types';

// promptFeedback fires when Gemini blocks the *prompt itself* before any candidate is produced;
// today `candidates` may be empty/missing in that case. Surface it as an error so the UI can show
// the user that the request was rejected upstream.
export function handlePromptFeedback(obj: Record<string, unknown>): ConnectorResult | null {
  const promptFeedback = obj.promptFeedback;
  if (!promptFeedback || typeof promptFeedback !== 'object') return null;
  const feedback = promptFeedback as Record<string, unknown>;
  const blockReason = typeof feedback.blockReason === 'string' ? feedback.blockReason : '';
  if (!blockReason) return null;
  const worstCategory = findWorstSafetyCategory(feedback.safetyRatings);
  const message = worstCategory
    ? `Gemini blocked the prompt (blockReason: ${blockReason}, worst category: ${worstCategory})`
    : `Gemini blocked the prompt (blockReason: ${blockReason})`;
  return { error: message, errorPayload: obj };
}
