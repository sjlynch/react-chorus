import { hasOwn } from '../objectUtils';
import { appendField, appendSource, appendToolDelta, hasToolDelta } from '../resultHelpers';
import type { ConnectorResult } from '../types';

export { hasOwn };

// Re-exported from the shared module so connector files importing these from
// `shared.ts` keep working; `mergeResult` below also depends on them.
export { appendField, appendSource, appendToolDelta, hasToolDelta };

export function mergeResult(target: ConnectorResult, source: ConnectorResult | null | undefined) {
  if (!source) return;
  if (source.text) appendField(target, 'text', source.text);
  if (source.reasoning) appendField(target, 'reasoning', source.reasoning);
  const sources = source.sources?.length ? source.sources : source.source ? [source.source] : [];
  for (const item of sources) appendSource(target, item);
  const toolDeltas = source.toolDeltas?.length ? source.toolDeltas : source.toolDelta ? [source.toolDelta] : [];
  for (const toolDelta of toolDeltas) appendToolDelta(target, toolDelta);
  if (source.error) target.error = source.error;
  if (hasOwn(source, 'errorPayload')) target.errorPayload = source.errorPayload;
  if (source.done) target.done = true;
}

export function stringFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return '';
}

/**
 * Resolved identity of a Responses API function call, recorded once
 * `response.output_item.added`/`.done` reveals the call id. Every
 * `function_call_arguments.delta` for the same call is replayed/emitted under
 * this single id so a late `output_item.added` does not split one logical tool
 * call into two rendered blocks.
 */
export interface ResponseToolRef {
  /** Canonical tool-block id reused for every delta of this call. */
  id: string;
  /** Real provider call id, when the provider supplied one. */
  providerId?: string;
}

export function collectTextFragments(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        return stringFromUnknown(obj.text) || stringFromUnknown(obj.summary) || stringFromUnknown(obj.content);
      }
      return '';
    }).join('');
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return stringFromUnknown(obj.text) || stringFromUnknown(obj.summary) || stringFromUnknown(obj.content);
  }
  return '';
}
