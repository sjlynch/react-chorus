/**
 * True when `value` is a recognised streaming-event frame — an OpenAI
 * `choices` chunk, a Gemini `candidates` chunk, an Anthropic / AI SDK delta,
 * a content-block frame, or any event carrying a non-`error` `type`
 * discriminator. See `extractErrorMessage` for why this gate exists.
 */
function hasStreamingEventShape(value: Record<string, unknown>): boolean {
  if ('choices' in value || 'candidates' in value || 'delta' in value || 'content_block' in value) {
    return true;
  }
  // Any event `type` other than the explicit `'error'` envelope — e.g.
  // `content_block_delta`, `text-delta`, `response.output_text.delta`.
  const type = value.type;
  return typeof type === 'string' && type !== '' && type !== 'error';
}

/**
 * Extract a human-readable error message from a streaming frame, or `null`
 * when the frame is not a terminal stream error.
 *
 * A bare top-level `error` *string* is only treated as terminal when the frame
 * has no recognised streaming-event shape. Legitimate frames — OpenAI `choices`
 * chunks, Gemini `candidates`, content-block deltas, AI SDK deltas, and custom
 * backends — can carry a field literally named `error` as normal output (for
 * example a tool input whose JSON is `{"q":"...","error":"none"}`). Treating
 * every such field as a stream error misclassifies those frames and would kill
 * the stream prematurely.
 *
 * Genuine error envelopes are still recognised regardless of frame shape:
 *  - a structured `{ error: { message } }` object (OpenAI / Anthropic / Gemini);
 *  - an explicit `{ type: 'error', message | errorText }` frame (Anthropic,
 *    Vercel AI SDK, SSE error framing).
 */
export function extractErrorMessage(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;

  const value = obj as Record<string, unknown>;
  const error = value.error;

  // A bare `error` string is ambiguous: only terminal on frames that are not
  // themselves a recognised streaming event.
  if (typeof error === 'string' && error && !hasStreamingEventShape(value)) {
    return error;
  }
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message) return message;
  }

  if (value.type === 'error' && typeof value.message === 'string' && value.message) {
    return value.message;
  }

  // Vercel AI SDK UI message stream error frames use { type: 'error', errorText: '...' }.
  if (value.type === 'error' && typeof value.errorText === 'string' && value.errorText) {
    return value.errorText;
  }

  return null;
}
