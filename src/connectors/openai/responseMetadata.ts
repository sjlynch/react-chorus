import type { ConnectorResult } from '../types';
import { extractUsage } from '../usage';
import { stringFromUnknown } from './shared';

/**
 * Response events we deliberately ignore (lifecycle signals with no useful UI payload).
 * Documented here so future readers don't think they were forgotten:
 *  - `response.created` — start-of-stream telemetry; no text yet.
 *  - `response.output_item.started` — item lifecycle marker preceding `.added`.
 */
export const IGNORED_RESPONSE_EVENT_TYPES = new Set([
  'response.created',
  'response.output_item.started',
]);

// `incomplete_details.reason` values (carried on `response.completed` and the
// terminal `response.incomplete` event) that mean the response was cut short —
// surfaced as a non-fatal `warning`, mirroring the Chat Completions / Gemini /
// Anthropic truncation signals.
const INCOMPLETE_REASON_WARNINGS: Record<string, { code: string; message: string }> = {
  max_output_tokens: { code: 'truncated', message: 'OpenAI response truncated by max_output_tokens' },
  max_tokens: { code: 'truncated', message: 'OpenAI response truncated by max_output_tokens' },
  content_filter: { code: 'content_filter', message: 'OpenAI response stopped by the content filter' },
};

/**
 * Surface a terminal response payload (`response.completed` / `response.incomplete`):
 * token usage and, when the response stopped early, its `incomplete_details`
 * reason as a finish reason + non-fatal warning. Without this a truncated
 * completion looks successful.
 */
export function applyResponseCompletion(result: ConnectorResult, obj: Record<string, unknown>) {
  const response = obj.response && typeof obj.response === 'object'
    ? obj.response as Record<string, unknown>
    : undefined;
  if (!response) return;

  const usage = extractUsage(response.usage);
  if (usage) result.metadata = { ...(result.metadata ?? {}), usage };

  const incompleteDetails = response.incomplete_details && typeof response.incomplete_details === 'object'
    ? response.incomplete_details as Record<string, unknown>
    : undefined;
  const reason = incompleteDetails ? stringFromUnknown(incompleteDetails.reason) : '';
  if (!reason) return;

  result.metadata = { ...(result.metadata ?? {}), finishReason: reason };
  const known = INCOMPLETE_REASON_WARNINGS[reason];
  result.warning = known
    ? { code: known.code, message: known.message, payload: obj }
    : { code: 'incomplete', message: `OpenAI response ended incomplete: ${reason}`, payload: obj };
}
