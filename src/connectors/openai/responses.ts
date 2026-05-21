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
  stringFromUnknown,
  type ResponseToolRef,
} from './shared';
import {
  bufferResponseToolArg,
  drainResponseToolBuffer,
  extractResponseToolId,
  outputIndexKey,
  refusalKey,
  replayBufferedToolArgs,
  toolDeltaFromRef,
} from './responseToolCalls';
import { applyResponseCompletion, IGNORED_RESPONSE_EVENT_TYPES } from './responseMetadata';
import { createThinkTagSplitter } from './thinkTagSplitter';

export { drainResponseToolBuffer };

export function extractOpenAIResponseEvent(obj: Record<string, unknown>, state: OpenAIConnectorState): ConnectorResult | null {
  const type = typeof obj.type === 'string' ? obj.type : '';
  const result: ConnectorResult = {};

  if (IGNORED_RESPONSE_EVENT_TYPES.has(type)) return null;

  // `response.incomplete` is a separate terminal event the API emits when a
  // response stops early (e.g. `max_output_tokens`); treat it exactly like
  // `response.completed` so the stream ends and `applyResponseCompletion`
  // still surfaces token usage plus the truncation finish reason / warning.
  if (type === 'response.completed' || type === 'response.incomplete') {
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
