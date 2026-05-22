import { DEFAULT_CANDIDATE_INDEX } from '../geminiSemantics';
import {
  sourcesFromGeminiCitationMetadata,
  sourcesFromGeminiGroundingMetadata,
} from '../sourceMapping';
import type { ConnectorResult } from '../types';
import { appendSource } from '../resultHelpers';
import { addWarning, appendField, appendToolDelta } from './result';
import { extractFunctionCallToolDelta } from './toolDeltas';
import type { GeminiConnectorState } from './state';
import { describeUnsupportedPart } from './unsupportedParts';

export function selectedCandidate(candidates: unknown[]) {
  const explicitIndex = candidates.findIndex(candidate => (candidate as { index?: unknown } | null)?.index === DEFAULT_CANDIDATE_INDEX);
  const index = explicitIndex >= 0 ? explicitIndex : 0;
  return { candidate: candidates[index], arrayIndex: index };
}

export function getCandidateKey(candidate: unknown, arrayIndex: number) {
  const providerIndex = (candidate as { index?: unknown } | null)?.index;
  return typeof providerIndex === 'number' || typeof providerIndex === 'string'
    ? String(providerIndex)
    : String(arrayIndex);
}

export function extractCandidateContent(
  candidateObj: Record<string, unknown>,
  candidateKey: string,
  result: ConnectorResult,
  state: GeminiConnectorState,
  payload: unknown,
) {
  // Gemini attaches grounding / citation metadata to the candidate (NOT inside
  // `parts`) when Search grounding or training-source citations are enabled,
  // and the metadata often arrives on the terminal frame whose `content.parts`
  // is empty — so extract sources before the parts check that returns early.
  // `appendMessageSource` (downstream in useChorusStream) dedups repeated
  // chunks across deltas via stable provider/url-derived ids.
  const groundingSources = sourcesFromGeminiGroundingMetadata(candidateObj.groundingMetadata);
  for (const source of groundingSources) appendSource(result, source);
  const citationSources = sourcesFromGeminiCitationMetadata(candidateObj.citationMetadata);
  for (const source of citationSources) appendSource(result, source);

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
  // contains *only* unrenderable parts (inlineData/fileData, or
  // executableCode/codeExecutionResult from the code-execution tool) is
  // observable instead of returning a silent null (a developer using a Gemini
  // image or code-execution model would otherwise see a blank assistant turn
  // with no diagnostic). The raw parts stay inspectable via `warning.payload`.
  // `addWarning` appends rather than overwrites, so a later `truncated` warning
  // on the same chunk does not clobber this one.
  if (unsupportedParts.length > 0) {
    addWarning(result, {
      code: 'unsupported-part',
      message:
        `Gemini emitted ${unsupportedParts.length} content part(s) react-chorus cannot render: ` +
        `${unsupportedParts.join(', ')}. Inline images / file references and code-execution output ` +
        `from Gemini multimodal, image-generation, or code-execution models are not surfaced as ` +
        `assistant content; inspect warning.payload for the raw chunk.`,
      payload,
    });
  }
}
