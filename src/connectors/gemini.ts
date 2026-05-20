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

/** A resolved function-call id plus whether it came from the provider. */
interface GeminiFunctionCallId {
  id: string;
  /** True when `id` is a real provider-supplied id rather than a Chorus fallback. */
  fromProvider: boolean;
}

/**
 * Per-send parser state for the Gemini connector.
 *
 * `functionCallIdsByCandidate` maps a candidate key to a (part index -> resolved
 * function-call id) map, resolved first-seen-wins. Gemini frequently streams a
 * single function call's name/arguments across multiple SSE frames, and later
 * frames often omit `name`. Without remembered ids the fallback id
 * `gemini-<candidate>-function-<part>-<name>` would change between frames
 * (`...-<name>` -> `...-call`), producing two Chorus tool-delta ids and a
 * duplicate placeholder tool block. Caching the first id keeps it stable.
 *
 * Mirrors the openai connector's `chatToolCallIds` map. Per the connector
 * contract this lives in per-send state, never module globals, so concurrent
 * Chorus instances do not share tool-id maps.
 */
export interface GeminiConnectorState {
  functionCallIdsByCandidate: Map<string, Map<number, GeminiFunctionCallId>>;
}

export function createGeminiConnectorState(): GeminiConnectorState {
  return { functionCallIdsByCandidate: new Map<string, Map<number, GeminiFunctionCallId>>() };
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

/**
 * Resolve the id for a functionCall part, first-seen-wins. The id resolved on the
 * first frame for a given candidate/part index is cached and reused for every
 * later frame, so a function call whose name/arguments stream across multiple
 * chunks keeps one stable id even when later frames omit `name`.
 */
function resolveFunctionCallId(
  state: GeminiConnectorState,
  candidateKey: string,
  partIndex: number,
  explicitId: string | undefined,
  name: string | undefined,
): GeminiFunctionCallId {
  let byPart = state.functionCallIdsByCandidate.get(candidateKey);
  if (!byPart) {
    byPart = new Map<number, GeminiFunctionCallId>();
    state.functionCallIdsByCandidate.set(candidateKey, byPart);
  }
  const existing = byPart.get(partIndex);
  if (existing) return existing;
  const resolved: GeminiFunctionCallId = explicitId
    ? { id: explicitId, fromProvider: true }
    : { id: `gemini-${candidateKey}-function-${partIndex}-${name ?? 'call'}`, fromProvider: false };
  byPart.set(partIndex, resolved);
  return resolved;
}

function extractFunctionCallToolDelta(
  part: Record<string, unknown>,
  candidateKey: string,
  partIndex: number,
  state: GeminiConnectorState,
): ConnectorToolDelta | null {
  const functionCall = part.functionCall;
  if (!functionCall || typeof functionCall !== 'object') return null;
  const call = functionCall as Record<string, unknown>;
  const name = typeof call.name === 'string' && call.name ? call.name : undefined;
  const explicitId = typeof call.id === 'string' && call.id ? call.id : undefined;
  const resolved = resolveFunctionCallId(state, candidateKey, partIndex, explicitId, name);
  const toolDelta: ConnectorToolDelta = { id: resolved.id, provider: 'gemini' };
  if (resolved.fromProvider) toolDelta.providerId = resolved.id;
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

// Gemini multimodal / image-generation models stream `inlineData` (base64 bytes
// with a mimeType) and `fileData` (a file URI) content parts. The connector has
// no text/reasoning/tool channel for binary payloads, so they cannot be rendered
// as assistant content today; snake_case spellings are accepted because some
// proxies/SDKs reshape the wire JSON.
const UNSUPPORTED_PART_KEYS: Array<{ key: string; label: string }> = [
  { key: 'inlineData', label: 'inlineData' },
  { key: 'inline_data', label: 'inlineData' },
  { key: 'fileData', label: 'fileData' },
  { key: 'file_data', label: 'fileData' },
];

/**
 * Detect a Gemini content part the connector cannot turn into text/reasoning/
 * tool output. Returns a short label (with mime type when present) so the
 * absence can be surfaced as a `ConnectorWarning` instead of silently dropping
 * the chunk; returns null for ordinary parts.
 */
function describeUnsupportedPart(partObj: Record<string, unknown>): string | null {
  for (const { key, label } of UNSUPPORTED_PART_KEYS) {
    const value = partObj[key];
    if (!value || typeof value !== 'object') continue;
    const data = value as Record<string, unknown>;
    const mimeType = typeof data.mimeType === 'string' && data.mimeType
      ? data.mimeType
      : typeof data.mime_type === 'string' && data.mime_type
        ? data.mime_type
        : undefined;
    return mimeType ? `${label} (${mimeType})` : label;
  }
  return null;
}

function extractCandidateContent(
  candidateObj: Record<string, unknown>,
  candidateKey: string,
  result: ConnectorResult,
  state: GeminiConnectorState,
  payload: unknown,
) {
  const parts = (candidateObj.content as { parts?: unknown } | undefined)?.parts;
  if (!Array.isArray(parts)) return;
  const unsupportedParts: string[] = [];
  parts.forEach((part, partIndex) => {
    if (!part || typeof part !== 'object') return;
    const partObj = part as Record<string, unknown>;
    if (typeof partObj.text === 'string' && partObj.text) {
      appendField(result, partObj.thought === true ? 'reasoning' : 'text', partObj.text);
    }
    if (typeof partObj.thinking === 'string' && partObj.thinking) appendField(result, 'reasoning', partObj.thinking);
    if (typeof partObj.reasoning === 'string' && partObj.reasoning) appendField(result, 'reasoning', partObj.reasoning);
    const toolDelta = extractFunctionCallToolDelta(partObj, candidateKey, partIndex, state);
    if (toolDelta) appendToolDelta(result, toolDelta);
    const unsupported = describeUnsupportedPart(partObj);
    if (unsupported) unsupportedParts.push(unsupported);
  });
  // Surface unsupported parts as a non-fatal warning so a candidate that
  // contains *only* inlineData/fileData is observable instead of returning a
  // silent null (a developer using a Gemini image model would otherwise see a
  // blank assistant turn with no diagnostic). The raw parts stay inspectable
  // via `warning.payload`.
  if (unsupportedParts.length > 0 && !result.warning) {
    result.warning = {
      code: 'unsupported-part',
      message:
        `Gemini emitted ${unsupportedParts.length} content part(s) react-chorus cannot render: ` +
        `${unsupportedParts.join(', ')}. Inline images / file references from Gemini multimodal or ` +
        `image-generation models are not surfaced as assistant content; inspect warning.payload for the raw chunk.`,
      payload,
    };
  }
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
 * `inlineData` / `fileData` parts (Gemini multimodal / image-generation output)
 * cannot be rendered as assistant content and instead surface an
 * `unsupported-part` warning so the chunk is never silently dropped.
 * When multiple candidates are present, only candidate index 0 is emitted;
 * alternatives are not concatenated. STOP and MAX_TOKENS finish the stream;
 * MAX_TOKENS additionally emits a `truncated` warning (with `metadata.finishReason`)
 * so consumers learn the response was cut off. Blocked/safety finish reasons
 * surface as connector errors. Gemini's
 * UNSPECIFIED finish reasons are also surfaced as explicit errors (rather than
 * ignored) so callers receive a terminal signal instead of hanging.
 *
 * `createState()` is called once per `send()`; the returned state keeps the
 * fallback function-call id map stable across SSE frames.
 *
 * Usage example:
 *   const { send } = useChorusStream(transport, { connector: 'gemini' });
 *
 * @internal Not part of the public API. Obtain it via `getConnector('gemini')`.
 */
export const geminiConnector: Connector<GeminiConnectorState> = {
  name: 'gemini',
  createState: createGeminiConnectorState,
  extract(data: string, state: GeminiConnectorState = createGeminiConnectorState()): ConnectorResult | null {
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

      extractCandidateContent(candidateObj, candidateKey, result, state, obj);

      const safetyRatings = candidateObj.safetyRatings;
      const worstSafetyCategory = findWorstSafetyCategory(safetyRatings);
      if (Array.isArray(safetyRatings) && safetyRatings.length > 0) {
        result.metadata = { ...(result.metadata ?? {}), safetyRatings };
      }

      const finalResult = applyFinishReason(result, candidateObj.finishReason, worstSafetyCategory, obj);
      if (finalResult.error) return finalResult;

      if (
        finalResult.text ||
        finalResult.reasoning ||
        hasToolDelta(finalResult) ||
        finalResult.done ||
        finalResult.metadata ||
        finalResult.warning
      ) {
        return finalResult;
      }
      return null;
    } catch {
      return null;
    }
  }
};
