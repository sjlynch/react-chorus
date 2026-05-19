import { extractErrorMessage } from './error';
import {
  DEFAULT_CANDIDATE_INDEX,
  findWorstSafetyCategory,
  geminiBlockedMessage,
  isBlockingFinishReason,
  isDoneFinishReason,
  isUnspecifiedFinishReason,
} from './geminiSemantics';
import { hasOwn } from './objectUtils';
import type { Connector, ConnectorResult, ConnectorToolDelta } from './types';

function appendField(target: ConnectorResult, key: 'text' | 'reasoning', value: string) {
  if (!value) return;
  target[key] = `${target[key] ?? ''}${value}`;
}

function appendToolDelta(target: ConnectorResult, toolDelta: ConnectorToolDelta) {
  if (!target.toolDelta) {
    target.toolDelta = toolDelta;
    return;
  }

  if (!target.toolDeltas) target.toolDeltas = [target.toolDelta];
  target.toolDeltas.push(toolDelta);
}

function hasToolDelta(result: ConnectorResult) {
  return Boolean(result.toolDelta || result.toolDeltas?.length);
}

function selectedCandidate(candidates: unknown[]) {
  const explicitIndex = candidates.findIndex(candidate => (candidate as { index?: unknown } | null)?.index === DEFAULT_CANDIDATE_INDEX);
  const index = explicitIndex >= 0 ? explicitIndex : 0;
  return { candidate: candidates[index], arrayIndex: index };
}

function getCandidateKey(candidate: unknown, arrayIndex: number) {
  const providerIndex = (candidate as { index?: unknown } | null)?.index;
  return typeof providerIndex === 'number' || typeof providerIndex === 'string'
    ? String(providerIndex)
    : String(arrayIndex);
}

function extractFunctionCallToolDelta(part: Record<string, unknown>, candidateKey: string, partIndex: number): ConnectorToolDelta | null {
  const functionCall = part.functionCall;
  if (!functionCall || typeof functionCall !== 'object') return null;
  const call = functionCall as Record<string, unknown>;
  const name = typeof call.name === 'string' && call.name ? call.name : undefined;
  const explicitId = typeof call.id === 'string' && call.id ? call.id : undefined;
  const id = explicitId ?? `gemini-${candidateKey}-function-${partIndex}-${name ?? 'call'}`;
  const toolDelta: ConnectorToolDelta = { id, provider: 'gemini' };
  if (explicitId) toolDelta.providerId = explicitId;
  else toolDelta.generated = true;
  if (name) toolDelta.name = name;
  if (hasOwn(call, 'args')) toolDelta.input = call.args;
  return toolDelta.name || hasOwn(toolDelta, 'input') ? toolDelta : null;
}

// promptFeedback fires when Gemini blocks the *prompt itself* before any candidate is produced;
// today `candidates` may be empty/missing in that case. Surface it as an error so the UI can show
// the user that the request was rejected upstream.
function handlePromptFeedback(obj: Record<string, unknown>): ConnectorResult | null {
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

function extractCandidateContent(candidateObj: Record<string, unknown>, candidateKey: string, result: ConnectorResult) {
  const parts = (candidateObj.content as { parts?: unknown } | undefined)?.parts;
  if (!Array.isArray(parts)) return;
  parts.forEach((part, partIndex) => {
    if (!part || typeof part !== 'object') return;
    const partObj = part as Record<string, unknown>;
    if (typeof partObj.text === 'string' && partObj.text) {
      appendField(result, partObj.thought === true ? 'reasoning' : 'text', partObj.text);
    }
    if (typeof partObj.thinking === 'string' && partObj.thinking) appendField(result, 'reasoning', partObj.thinking);
    if (typeof partObj.reasoning === 'string' && partObj.reasoning) appendField(result, 'reasoning', partObj.reasoning);
    const toolDelta = extractFunctionCallToolDelta(partObj, candidateKey, partIndex);
    if (toolDelta) appendToolDelta(result, toolDelta);
  });
}

function applyFinishReason(
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
      result.warning = {
        code: 'truncated',
        message: 'Gemini response truncated by maxOutputTokens',
        payload: obj,
      };
    }
  }
  return result;
}

/**
 * Google Gemini streaming connector (Google AI / Vertex AI).
 * Expects SSE data lines with JSON objects containing a "candidates" array.
 * Yields text from the selected candidate's content.parts[*].text, reasoning
 * from thought/thinking parts, and tool-use deltas from functionCall parts.
 * When multiple candidates are present, only candidate index 0 is emitted;
 * alternatives are not concatenated. STOP and MAX_TOKENS finish the stream;
 * MAX_TOKENS additionally emits a `truncated` warning (with `metadata.finishReason`)
 * so consumers learn the response was cut off. Blocked/safety finish reasons
 * surface as connector errors. Gemini's
 * UNSPECIFIED finish reasons are also surfaced as explicit errors (rather than
 * ignored) so callers receive a terminal signal instead of hanging.
 *
 * Usage example:
 *   const { send } = useChorusStream(transport, { connector: 'gemini' });
 */
export const geminiConnector: Connector = {
  name: 'gemini',
  extract(data: string): ConnectorResult | null {
    try {
      const obj = JSON.parse(data);
      const error = extractErrorMessage(obj);
      if (error) return { error, errorPayload: obj };
      if (!obj || typeof obj !== 'object') return null;

      const promptBlocked = handlePromptFeedback(obj as Record<string, unknown>);
      if (promptBlocked) return promptBlocked;

      if (!Array.isArray(obj.candidates) || obj.candidates.length === 0) return null;

      const { candidate, arrayIndex } = selectedCandidate(obj.candidates);
      if (!candidate || typeof candidate !== 'object') return null;

      const candidateObj = candidate as Record<string, unknown>;
      const candidateKey = getCandidateKey(candidate, arrayIndex);
      const result: ConnectorResult = {};

      extractCandidateContent(candidateObj, candidateKey, result);

      const safetyRatings = candidateObj.safetyRatings;
      const worstSafetyCategory = findWorstSafetyCategory(safetyRatings);
      if (Array.isArray(safetyRatings) && safetyRatings.length > 0) {
        result.metadata = { ...(result.metadata ?? {}), safetyRatings };
      }

      const finalResult = applyFinishReason(result, candidateObj.finishReason, worstSafetyCategory, obj);
      if (finalResult.error) return finalResult;

      if (finalResult.text || finalResult.reasoning || hasToolDelta(finalResult) || finalResult.done || finalResult.metadata) return finalResult;
      return null;
    } catch {
      return null;
    }
  }
};
