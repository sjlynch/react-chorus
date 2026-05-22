/**
 * Shared token-usage normalizer for connector `metadata.usage`.
 *
 * Each provider names its token counts differently:
 *  - OpenAI Chat Completions — `prompt_tokens` / `completion_tokens` / `total_tokens`
 *  - OpenAI Responses + Anthropic — `input_tokens` / `output_tokens` (+ `total_tokens` on Responses)
 *  - Gemini `usageMetadata` — `promptTokenCount` / `candidatesTokenCount` / `totalTokenCount`
 *  - Vercel AI SDK — `promptTokens` / `completionTokens` (v4) or `inputTokens` / `outputTokens` (v5),
 *    both with `totalTokens`; carried on the AI SDK `d:` / `finish` terminal frames
 *
 * `extractUsage` collapses all of them into the consistent
 * `{ promptTokens, completionTokens, totalTokens }` shape that
 * `ConnectorResult.metadata.usage` documents, so a cost-telemetry consumer
 * wiring `onMetadata`/`onStreamMetadata` sees the same object regardless of
 * provider. Lives at the connector root (not under `openai/`) so the Anthropic
 * and Gemini connectors can share it without pulling in the OpenAI chunk.
 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Normalize a provider `usage` / `usageMetadata` object. Returns `undefined`
 * when the payload carries no recognised token count, so callers can skip
 * attaching an empty `usage` object to `metadata`.
 */
export function extractUsage(usage: unknown): Record<string, number> | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const out: Record<string, number> = {};
  const promptTokens = finiteNumber(
    u.input_tokens ?? u.prompt_tokens ?? u.promptTokenCount ?? u.inputTokens ?? u.promptTokens,
  );
  const completionTokens = finiteNumber(
    u.output_tokens ?? u.completion_tokens ?? u.candidatesTokenCount ?? u.outputTokens ?? u.completionTokens,
  );
  const totalTokens = finiteNumber(u.total_tokens ?? u.totalTokenCount ?? u.totalTokens);
  if (promptTokens !== undefined) out.promptTokens = promptTokens;
  if (completionTokens !== undefined) out.completionTokens = completionTokens;
  if (totalTokens !== undefined) out.totalTokens = totalTokens;
  return Object.keys(out).length > 0 ? out : undefined;
}
