import { extractErrorMessage } from '../error';
import { findWorstSafetyCategory } from '../geminiSemantics';
import type { Connector, ConnectorResult } from '../types';
import { extractCandidateContent, getCandidateKey, selectedCandidate } from './candidates';
import { applyFinishReason } from './finish';
import { handlePromptFeedback } from './promptFeedback';
import { hasToolDelta } from './result';
import { createGeminiConnectorState, type GeminiConnectorState } from './state';

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

      const payload = obj as Record<string, unknown>;
      const promptBlocked = handlePromptFeedback(payload);
      if (promptBlocked) return promptBlocked;

      if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) return null;

      const { candidate, arrayIndex } = selectedCandidate(payload.candidates);
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
  },
};
