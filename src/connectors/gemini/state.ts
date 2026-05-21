/** A resolved function-call id plus whether it came from the provider. */
export interface GeminiFunctionCallId {
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

/**
 * Resolve the id for a functionCall part, first-seen-wins. The id resolved on the
 * first frame for a given candidate/part index is cached and reused for every
 * later frame, so a function call whose name/arguments stream across multiple
 * chunks keeps one stable id even when later frames omit `name`.
 */
export function resolveFunctionCallId(
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
