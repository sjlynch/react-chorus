import { extractErrorMessage } from './error';
import type { Connector, ConnectorResult, ConnectorToolDelta } from './types';

const DEFAULT_CANDIDATE_INDEX = 0;
const NORMAL_FINISH_REASONS = new Set(['STOP', 'MAX_TOKENS']);
const UNSPECIFIED_FINISH_REASONS = new Set(['FINISH_REASON_UNSPECIFIED', 'UNSPECIFIED']);

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

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

function isUnspecifiedFinishReason(finishReason: unknown): finishReason is string {
  return typeof finishReason === 'string' && UNSPECIFIED_FINISH_REASONS.has(finishReason);
}

function isBlockingFinishReason(finishReason: unknown): finishReason is string {
  if (typeof finishReason !== 'string' || !finishReason) return false;
  return !NORMAL_FINISH_REASONS.has(finishReason) && !UNSPECIFIED_FINISH_REASONS.has(finishReason);
}

function isDoneFinishReason(finishReason: unknown): finishReason is string {
  return typeof finishReason === 'string' && NORMAL_FINISH_REASONS.has(finishReason);
}

function geminiBlockedMessage(finishReason: string, hasText: boolean, worstCategory?: string) {
  const base = hasText
    ? `Gemini response ended with blocked finishReason: ${finishReason}`
    : `Gemini response was blocked and returned no text (finishReason: ${finishReason})`;
  return worstCategory ? `${base} (worst category: ${worstCategory})` : base;
}

const SAFETY_PROBABILITY_RANK: Record<string, number> = {
  NEGLIGIBLE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

/**
 * Pick the highest-severity safety rating from a `candidate.safetyRatings` array. Returns the
 * category string of the rating with the largest `probability` (or the first `blocked: true`
 * rating, which trumps probability). Used to enrich blocked-finish-reason error messages.
 */
function findWorstSafetyCategory(safetyRatings: unknown): string | undefined {
  if (!Array.isArray(safetyRatings) || safetyRatings.length === 0) return undefined;
  let worstCategory: string | undefined;
  let worstRank = -1;
  for (const rating of safetyRatings) {
    if (!rating || typeof rating !== 'object') continue;
    const r = rating as Record<string, unknown>;
    const category = typeof r.category === 'string' ? r.category : undefined;
    if (!category) continue;
    if (r.blocked === true) return category;
    const probability = typeof r.probability === 'string' ? r.probability : undefined;
    const rank = probability ? SAFETY_PROBABILITY_RANK[probability] ?? -1 : -1;
    if (rank > worstRank) {
      worstRank = rank;
      worstCategory = category;
    }
  }
  return worstCategory;
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

      // promptFeedback fires when Gemini blocks the *prompt itself* before any candidate is
      // produced; today `candidates` may be empty/missing in that case. Surface it as an error
      // so the UI can show the user that the request was rejected upstream.
      const promptFeedback = (obj as Record<string, unknown>).promptFeedback;
      if (promptFeedback && typeof promptFeedback === 'object') {
        const feedback = promptFeedback as Record<string, unknown>;
        const blockReason = typeof feedback.blockReason === 'string' ? feedback.blockReason : '';
        if (blockReason) {
          const worstCategory = findWorstSafetyCategory(feedback.safetyRatings);
          const message = worstCategory
            ? `Gemini blocked the prompt (blockReason: ${blockReason}, worst category: ${worstCategory})`
            : `Gemini blocked the prompt (blockReason: ${blockReason})`;
          return { error: message, errorPayload: obj };
        }
      }

      if (!Array.isArray(obj.candidates) || obj.candidates.length === 0) return null;

      const { candidate, arrayIndex } = selectedCandidate(obj.candidates);
      if (!candidate || typeof candidate !== 'object') return null;

      const candidateObj = candidate as Record<string, unknown>;
      const result: ConnectorResult = {};
      const parts = (candidateObj.content as { parts?: unknown } | undefined)?.parts;
      const candidateKey = getCandidateKey(candidate, arrayIndex);

      if (Array.isArray(parts)) {
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

      const safetyRatings = candidateObj.safetyRatings;
      const worstSafetyCategory = findWorstSafetyCategory(safetyRatings);
      if (Array.isArray(safetyRatings) && safetyRatings.length > 0) {
        result.metadata = { ...(result.metadata ?? {}), safetyRatings };
      }

      const finishReason = candidateObj.finishReason;
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

      if (result.text || result.reasoning || hasToolDelta(result) || result.done || result.error || result.metadata) return result;
      return null;
    } catch {
      return null;
    }
  }
};
