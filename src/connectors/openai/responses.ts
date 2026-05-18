import { extractErrorMessage } from '../error';
import type { ConnectorResult, ConnectorToolDelta } from '../types';
import type { OpenAIConnectorState } from '../openai';
import { appendField, appendToolDelta, collectTextFragments, hasOwn, hasToolDelta, mergeResult, stringFromUnknown } from './shared';
import { createThinkTagSplitter } from './thinkTagSplitter';

function extractResponseToolId(obj: Record<string, unknown>) {
  const itemId = stringFromUnknown(obj.item_id);
  if (itemId) return itemId;
  const outputIndex = typeof obj.output_index === 'number' || typeof obj.output_index === 'string' ? String(obj.output_index) : '';
  return outputIndex ? `openai-response-output-${outputIndex}` : '';
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
  return stringFromUnknown(obj.item_id) || stringFromUnknown(obj.output_index) || '';
}

export function extractOpenAIResponseEvent(obj: Record<string, unknown>, state: OpenAIConnectorState): ConnectorResult | null {
  const type = typeof obj.type === 'string' ? obj.type : '';
  const result: ConnectorResult = {};

  if (IGNORED_RESPONSE_EVENT_TYPES.has(type)) return null;

  if (type === 'response.completed') {
    mergeResult(result, createThinkTagSplitter(state.thinkState, state.thinkOptions).flush());
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
    if (text) mergeResult(result, createThinkTagSplitter(state.thinkState, state.thinkOptions).feed(text));
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
      const id = callId || itemId || `openai-response-output-${stringFromUnknown(obj.output_index) || '0'}`;
      const name = stringFromUnknown(item.name);
      if (itemId && callId) state.responseToolCallIds.set(itemId, callId);
      const toolDelta: ConnectorToolDelta = { id, provider: 'openai' };
      if (callId) toolDelta.providerId = callId;
      else toolDelta.generated = true;
      if (name) toolDelta.name = name;
      if (hasOwn(item, 'arguments')) toolDelta.input = item.arguments;
      appendToolDelta(result, toolDelta);
    }
  }

  if (type === 'response.function_call_arguments.delta') {
    const rawId = extractResponseToolId(obj);
    const mappedId = state.responseToolCallIds.get(rawId);
    const id = mappedId ?? rawId;
    if (id) appendToolDelta(result, {
      id,
      input: obj.delta,
      provider: 'openai',
      ...(mappedId ? { providerId: mappedId } : { generated: true }),
    });
  }

  return result.text || result.reasoning || hasToolDelta(result) || result.done || result.error ? result : null;
}
