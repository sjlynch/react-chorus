import type { ConnectorResult } from '../types';
import type { OpenAIConnectorState } from '../openai';
import { appendToolDelta, mergeResult } from './shared';
import { drainResponseRefusalText, drainResponseToolBuffer } from './responseToolCalls';
import { applyResponseCompletion } from './responseMetadata';
import { createThinkTagSplitter } from './thinkTagSplitter';

/**
 * Terminal `response.completed` / `response.incomplete` events.
 *
 * `response.incomplete` is a separate terminal event the API emits when a
 * response stops early (e.g. `max_output_tokens`); it is treated exactly like
 * `response.completed` so the stream ends and `applyResponseCompletion` still
 * surfaces token usage plus the truncation finish reason / warning.
 */
export function handleResponseTerminalEvent(obj: Record<string, unknown>, state: OpenAIConnectorState): ConnectorResult {
  const result: ConnectorResult = {};
  mergeResult(result, createThinkTagSplitter(state.thinkState, state.thinkTags).flush());
  // Replay tool-call deltas whose `output_item.added` was dropped entirely.
  for (const toolDelta of drainResponseToolBuffer(state)) appendToolDelta(result, toolDelta);
  applyResponseCompletion(result, obj);
  // Surface any refusal buffered across `refusal.added`/`.delta` that never
  // got its closing `refusal.done`, mirroring the orphan-tool-arg drain above —
  // otherwise the refusal is silently lost and the turn renders blank.
  const refusal = drainResponseRefusalText(state);
  if (refusal) {
    result.error = refusal;
    result.errorPayload = obj;
  }
  result.done = true;
  return result;
}
