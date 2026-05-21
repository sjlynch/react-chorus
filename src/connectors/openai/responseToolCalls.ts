import type { ConnectorResult, ConnectorToolDelta } from '../types';
import type { OpenAIConnectorState } from '../openai';
import { appendToolDelta, stringFromUnknown, type ResponseToolRef } from './shared';

/** Stable fallback key for a function call identified only by its (usually numeric) output_index. */
export function outputIndexKey(obj: Record<string, unknown>): string {
  const outputIndex = obj.output_index;
  return typeof outputIndex === 'number' || typeof outputIndex === 'string'
    ? `openai-response-output-${outputIndex}`
    : '';
}

export function extractResponseToolId(obj: Record<string, unknown>) {
  const itemId = stringFromUnknown(obj.item_id);
  if (itemId) return itemId;
  return outputIndexKey(obj);
}

export function refusalKey(obj: Record<string, unknown>) {
  const itemId = stringFromUnknown(obj.item_id);
  if (itemId) return itemId;
  // output_index is virtually always a number in the Responses API, so stringify
  // it like extractResponseToolId does — otherwise numeric-only refusals all
  // collapse onto the '' key and cross-contaminate.
  const outputIndex = obj.output_index;
  return typeof outputIndex === 'number' || typeof outputIndex === 'string' ? String(outputIndex) : '';
}

export function bufferResponseToolArg(state: OpenAIConnectorState, key: string, delta: unknown) {
  const existing = state.responseToolArgBuffer.get(key);
  if (existing) existing.push(delta);
  else state.responseToolArgBuffer.set(key, [delta]);
}

export function toolDeltaFromRef(ref: ResponseToolRef, input: unknown): ConnectorToolDelta {
  return {
    id: ref.id,
    input,
    provider: 'openai',
    ...(ref.providerId ? { providerId: ref.providerId } : { generated: true }),
  };
}

/**
 * Replay any `function_call_arguments.delta` payloads buffered under `key`
 * (an item_id or output-index fallback) now that `ref` resolves the call's
 * canonical id. Cleared from the buffer so they are not replayed again.
 */
export function replayBufferedToolArgs(
  state: OpenAIConnectorState,
  key: string,
  ref: ResponseToolRef,
  result: ConnectorResult,
) {
  if (!key) return;
  const buffered = state.responseToolArgBuffer.get(key);
  if (!buffered) return;
  state.responseToolArgBuffer.delete(key);
  for (const input of buffered) appendToolDelta(result, toolDeltaFromRef(ref, input));
}

/**
 * Drain every still-buffered `function_call_arguments.delta` — used when a
 * stream ends without the matching `output_item.added` ever arriving, so the
 * tool call still surfaces (under a generated id) instead of being dropped.
 */
export function drainResponseToolBuffer(state: OpenAIConnectorState): ConnectorToolDelta[] {
  const toolDeltas: ConnectorToolDelta[] = [];
  for (const [key, inputs] of state.responseToolArgBuffer) {
    for (const input of inputs) toolDeltas.push(toolDeltaFromRef({ id: key }, input));
  }
  state.responseToolArgBuffer.clear();
  return toolDeltas;
}
