import { extractErrorMessage } from './error';
import type { Connector, ConnectorResult, ConnectorToolDelta } from './openai';

const DEFAULT_CANDIDATE_INDEX = 0;
const NORMAL_FINISH_REASONS = new Set(['STOP', 'MAX_TOKENS']);
const INCOMPLETE_FINISH_REASONS = new Set(['FINISH_REASON_UNSPECIFIED', 'UNSPECIFIED']);

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function appendField(target: ConnectorResult, key: 'text' | 'reasoning', value: string) {
  if (!value) return;
  target[key] = `${target[key] ?? ''}${value}`;
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

function isBlockingFinishReason(finishReason: unknown): finishReason is string {
  if (typeof finishReason !== 'string' || !finishReason) return false;
  return !NORMAL_FINISH_REASONS.has(finishReason) && !INCOMPLETE_FINISH_REASONS.has(finishReason);
}

function isDoneFinishReason(finishReason: unknown): finishReason is string {
  return typeof finishReason === 'string' && NORMAL_FINISH_REASONS.has(finishReason);
}

function geminiBlockedMessage(finishReason: string, hasText: boolean) {
  return hasText
    ? `Gemini response ended with blocked finishReason: ${finishReason}`
    : `Gemini response was blocked and returned no text (finishReason: ${finishReason})`;
}

function extractFunctionCallToolDelta(part: Record<string, unknown>, candidateKey: string, partIndex: number): ConnectorToolDelta | null {
  const functionCall = part.functionCall;
  if (!functionCall || typeof functionCall !== 'object') return null;
  const call = functionCall as Record<string, unknown>;
  const name = typeof call.name === 'string' && call.name ? call.name : undefined;
  const id = typeof call.id === 'string' && call.id
    ? call.id
    : `gemini-${candidateKey}-function-${partIndex}-${name ?? 'call'}`;
  const toolDelta: ConnectorToolDelta = { id };
  if (name) toolDelta.name = name;
  if (hasOwn(call, 'args')) toolDelta.input = call.args;
  if (hasOwn(call, 'response')) toolDelta.output = call.response;
  return toolDelta.name || hasOwn(toolDelta, 'input') || hasOwn(toolDelta, 'output') ? toolDelta : null;
}

/**
 * Google Gemini streaming connector (Google AI / Vertex AI).
 * Expects SSE data lines with JSON objects containing a "candidates" array.
 * Yields text from the selected candidate's content.parts[*].text, reasoning
 * from thought/thinking parts, and tool-use deltas from functionCall parts.
 * When multiple candidates are present, only candidate index 0 is emitted;
 * alternatives are not concatenated. STOP and MAX_TOKENS finish the stream,
 * while blocked/safety finish reasons surface as connector errors.
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
      if (error) return { error };
      if (!obj || !Array.isArray(obj.candidates) || obj.candidates.length === 0) return null;

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
          if (!result.toolDelta) {
            const toolDelta = extractFunctionCallToolDelta(partObj, candidateKey, partIndex);
            if (toolDelta) result.toolDelta = toolDelta;
          }
        });
      }

      const finishReason = candidateObj.finishReason;
      if (isBlockingFinishReason(finishReason)) {
        return {
          ...result,
          error: geminiBlockedMessage(finishReason, Boolean(result.text || result.reasoning)),
        };
      }

      if (isDoneFinishReason(finishReason)) result.done = true;

      if (result.text || result.reasoning || result.toolDelta || result.done || result.error) return result;
      return null;
    } catch {
      return null;
    }
  }
};
