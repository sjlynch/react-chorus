import { extractErrorMessage } from '../error';
import type { ConnectorResult, ConnectorToolDelta } from '../types';
import type { OpenAIConnectorState } from '../openai';
import {
  appendField,
  appendToolDelta,
  collectTextFragments,
  hasOwn,
  hasToolDelta,
  mergeResult,
  numberFromUnknown,
  stringFromUnknown,
  type ResponseToolRef,
} from './shared';
import { createThinkTagSplitter } from './thinkTagSplitter';

/** Stable fallback key for a function call identified only by its (usually numeric) output_index. */
function outputIndexKey(obj: Record<string, unknown>): string {
  const outputIndex = obj.output_index;
  return typeof outputIndex === 'number' || typeof outputIndex === 'string'
    ? `openai-response-output-${outputIndex}`
    : '';
}

function extractResponseToolId(obj: Record<string, unknown>) {
  const itemId = stringFromUnknown(obj.item_id);
  if (itemId) return itemId;
  return outputIndexKey(obj);
}

/**
 * Response events we deliberately ignore (lifecycle signals with no useful UI payload).
 * Documented here so future readers don't think they were forgotten:
 *  - `response.created` — start-of-stream telemetry; no text yet.
 *  - `response.output_item.started` — item lifecycle marker preceding `.added`.
 */
const IGNORED_RESPONSE_EVENT_TYPES = new Set([
  'response.created',
  'response.output_item.started',
]);

function refusalKey(obj: Record<string, unknown>) {
  const itemId = stringFromUnknown(obj.item_id);
  if (itemId) return itemId;
  // output_index is virtually always a number in the Responses API, so stringify
  // it like extractResponseToolId does — otherwise numeric-only refusals all
  // collapse onto the '' key and cross-contaminate.
  const outputIndex = obj.output_index;
  return typeof outputIndex === 'number' || typeof outputIndex === 'string' ? String(outputIndex) : '';
}

function bufferResponseToolArg(state: OpenAIConnectorState, key: string, delta: unknown) {
  const existing = state.responseToolArgBuffer.get(key);
  if (existing) existing.push(delta);
  else state.responseToolArgBuffer.set(key, [delta]);
}

function toolDeltaFromRef(ref: ResponseToolRef, input: unknown): ConnectorToolDelta {
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
function replayBufferedToolArgs(
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

function extractResponseUsage(usage: unknown): Record<string, number> | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const out: Record<string, number> = {};
  const promptTokens = numberFromUnknown(u.input_tokens ?? u.prompt_tokens);
  const completionTokens = numberFromUnknown(u.output_tokens ?? u.completion_tokens);
  const totalTokens = numberFromUnknown(u.total_tokens);
  if (promptTokens !== undefined) out.promptTokens = promptTokens;
  if (completionTokens !== undefined) out.completionTokens = completionTokens;
  if (totalTokens !== undefined) out.totalTokens = totalTokens;
  return Object.keys(out).length > 0 ? out : undefined;
}

// `response.completed.response.incomplete_details.reason` values that mean the
// response was cut short — surfaced as a non-fatal `warning`, mirroring the
// Chat Completions / Gemini / Anthropic truncation signals.
const INCOMPLETE_REASON_WARNINGS: Record<string, { code: string; message: string }> = {
  max_output_tokens: { code: 'truncated', message: 'OpenAI response truncated by max_output_tokens' },
  max_tokens: { code: 'truncated', message: 'OpenAI response truncated by max_output_tokens' },
  content_filter: { code: 'content_filter', message: 'OpenAI response stopped by the content filter' },
};

/**
 * Surface the terminal `response.completed` payload: token usage and, when the
 * response stopped early, its `incomplete_details` reason as a finish reason +
 * non-fatal warning. Without this a truncated completion looks successful.
 */
function applyResponseCompletion(result: ConnectorResult, obj: Record<string, unknown>) {
  const response = obj.response && typeof obj.response === 'object'
    ? obj.response as Record<string, unknown>
    : undefined;
  if (!response) return;

  const usage = extractResponseUsage(response.usage);
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

export function extractOpenAIResponseEvent(obj: Record<string, unknown>, state: OpenAIConnectorState): ConnectorResult | null {
  const type = typeof obj.type === 'string' ? obj.type : '';
  const result: ConnectorResult = {};

  if (IGNORED_RESPONSE_EVENT_TYPES.has(type)) return null;

  if (type === 'response.completed') {
    mergeResult(result, createThinkTagSplitter(state.thinkState, state.thinkTags).flush());
    // Replay tool-call deltas whose `output_item.added` was dropped entirely.
    for (const toolDelta of drainResponseToolBuffer(state)) appendToolDelta(result, toolDelta);
    applyResponseCompletion(result, obj);
    result.done = true;
    return result;
  }

  if (type === 'response.failed') {
    const error = extractErrorMessage(obj) || collectTextFragments(obj.response) || 'OpenAI response failed';
    return { error, errorPayload: obj };
  }

  // Inline (non-terminal in the protocol, but terminal for our UI) error event.
  if (type === 'response.error') {
    const error = extractErrorMessage(obj) || stringFromUnknown(obj.message) || stringFromUnknown(obj.code) || 'OpenAI response error';
    return { error, errorPayload: obj };
  }

  if (type === 'response.refusal.added') {
    state.responseRefusalText.set(refusalKey(obj), '');
    return null;
  }

  if (type === 'response.refusal.delta') {
    const key = refusalKey(obj);
    const delta = stringFromUnknown(obj.delta);
    if (delta) state.responseRefusalText.set(key, (state.responseRefusalText.get(key) ?? '') + delta);
    return null;
  }

  if (type === 'response.refusal.done') {
    const key = refusalKey(obj);
    const finalText = stringFromUnknown(obj.refusal) || state.responseRefusalText.get(key) || 'OpenAI model refused to respond';
    state.responseRefusalText.delete(key);
    return { error: finalText, errorPayload: obj };
  }

  if (type === 'response.output_text.delta') {
    const text = stringFromUnknown(obj.delta);
    if (text) mergeResult(result, createThinkTagSplitter(state.thinkState, state.thinkTags).feed(text));
  }

  if (
    type === 'response.reasoning_summary_text.delta' ||
    type === 'response.reasoning_text.delta' ||
    type === 'response.reasoning_summary.delta'
  ) {
    const reasoning = collectTextFragments(obj.delta) || collectTextFragments(obj.text);
    if (reasoning) appendField(result, 'reasoning', reasoning);
  }

  if (type === 'response.output_item.added' || type === 'response.output_item.done') {
    const item = obj.item && typeof obj.item === 'object' ? obj.item as Record<string, unknown> : undefined;
    if (item?.type === 'function_call') {
      const callId = stringFromUnknown(item.call_id);
      const itemId = stringFromUnknown(item.id);
      const indexKey = outputIndexKey(obj);
      const id = callId || itemId || indexKey || 'openai-response-output-0';
      const name = stringFromUnknown(item.name);
      const ref: ResponseToolRef = callId ? { id, providerId: callId } : { id };

      // Register the resolved identity under every key a delta might use so
      // earlier and later deltas collapse onto this single tool block.
      if (itemId) state.responseToolAliases.set(itemId, ref);
      if (indexKey) state.responseToolAliases.set(indexKey, ref);

      const toolDelta: ConnectorToolDelta = { id, provider: 'openai' };
      if (callId) toolDelta.providerId = callId;
      else toolDelta.generated = true;
      if (name) toolDelta.name = name;
      if (hasOwn(item, 'arguments')) toolDelta.input = item.arguments;
      appendToolDelta(result, toolDelta);

      // Replay deltas that arrived before this event resolved the call id.
      replayBufferedToolArgs(state, itemId, ref, result);
      replayBufferedToolArgs(state, indexKey, ref, result);
    }
  }

  if (type === 'response.function_call_arguments.delta') {
    const rawId = extractResponseToolId(obj);
    if (rawId) {
      const ref = state.responseToolAliases.get(rawId);
      // Buffer until `output_item.added` resolves the call id; otherwise a late
      // `output_item.added` would split this call across two tool blocks.
      if (ref) appendToolDelta(result, toolDeltaFromRef(ref, obj.delta));
      else bufferResponseToolArg(state, rawId, obj.delta);
    }
  }

  return result.text || result.reasoning || hasToolDelta(result) || result.done || result.error ? result : null;
}
