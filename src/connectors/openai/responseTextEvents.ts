import type { ConnectorResult } from '../types';
import type { OpenAIConnectorState } from '../openai';
import { appendField, collectTextFragments, mergeResult, stringFromUnknown } from './shared';
import { createThinkTagSplitter } from './thinkTagSplitter';

/**
 * Text and reasoning deltas.
 *
 * `response.output_text.delta` carries assistant output text — routed through
 * the `<think>`-tag splitter so inline reasoning traces still split out. The
 * `response.reasoning_summary_text.delta` / `response.reasoning_text.delta` /
 * `response.reasoning_summary.delta` variants carry the reasoning trace
 * directly. Returns `null` when the event yields no text or reasoning.
 */
export function handleResponseTextEvent(obj: Record<string, unknown>, state: OpenAIConnectorState): ConnectorResult | null {
  const result: ConnectorResult = {};

  if (obj.type === 'response.output_text.delta') {
    const text = stringFromUnknown(obj.delta);
    if (text) mergeResult(result, createThinkTagSplitter(state.thinkState, state.thinkTags).feed(text));
  } else {
    // A `response.reasoning_*` delta variant.
    const reasoning = collectTextFragments(obj.delta) || collectTextFragments(obj.text);
    if (reasoning) appendField(result, 'reasoning', reasoning);
  }

  return result.text || result.reasoning ? result : null;
}
