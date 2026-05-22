import type { ConnectorResult, ConnectorToolDelta } from '../types';
import type { OpenAIConnectorState } from '../openai';
import { appendToolDelta, hasOwn, hasToolDelta, stringFromUnknown, type ResponseToolRef } from './shared';
import {
  bufferResponseToolArg,
  extractResponseToolId,
  outputIndexKey,
  replayBufferedToolArgs,
  toolDeltaFromRef,
} from './responseToolCalls';

/**
 * Tool-call lifecycle: `response.output_item.added` / `.done` and
 * `response.function_call_arguments.delta`.
 *
 * `output_item.added`/`.done` resolve a function call's (late-arriving) id and
 * register aliases under every key a delta might use, so buffered argument
 * deltas can be replayed onto a single tool block. `function_call_arguments.delta`
 * either emits straight away (if the id is already resolved) or is buffered
 * until `output_item.added` resolves it. Returns `null` when the event only
 * buffers and produces no tool delta.
 */
export function handleResponseToolEvent(obj: Record<string, unknown>, state: OpenAIConnectorState): ConnectorResult | null {
  const result: ConnectorResult = {};
  const type = obj.type;

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
      // `output_item.done` carries the COMPLETE accumulated `arguments` string,
      // but the `function_call_arguments.delta` events already streamed every
      // fragment and the downstream accumulator concatenates string inputs — so
      // re-emitting it here would double the arguments into invalid JSON. Only
      // `.added` (whose `arguments` is empty) seeds the input; `.done` just
      // confirms the call's id/name.
      if (type === 'response.output_item.added' && hasOwn(item, 'arguments')) toolDelta.input = item.arguments;
      appendToolDelta(result, toolDelta);

      // Replay deltas that arrived before this event resolved the call id.
      replayBufferedToolArgs(state, itemId, ref, result);
      replayBufferedToolArgs(state, indexKey, ref, result);
    }
  } else {
    // `response.function_call_arguments.delta`
    const rawId = extractResponseToolId(obj);
    if (rawId) {
      const ref = state.responseToolAliases.get(rawId);
      // Buffer until `output_item.added` resolves the call id; otherwise a late
      // `output_item.added` would split this call across two tool blocks.
      if (ref) appendToolDelta(result, toolDeltaFromRef(ref, obj.delta));
      else bufferResponseToolArg(state, rawId, obj.delta);
    }
  }

  return hasToolDelta(result) ? result : null;
}
