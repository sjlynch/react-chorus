import { hasOwn } from '../objectUtils';
import type { ConnectorResult, ConnectorToolDelta } from '../types';

export { hasOwn };

export function appendField(target: ConnectorResult, key: 'text' | 'reasoning', value: string) {
  if (!value) return;
  target[key] = `${target[key] ?? ''}${value}`;
}

export function appendToolDelta(target: ConnectorResult, toolDelta: ConnectorToolDelta) {
  if (!target.toolDelta) {
    target.toolDelta = toolDelta;
    return;
  }

  if (!target.toolDeltas) target.toolDeltas = [target.toolDelta];
  target.toolDeltas.push(toolDelta);
}

export function hasToolDelta(result: ConnectorResult) {
  return Boolean(result.toolDelta || result.toolDeltas?.length);
}

export function mergeResult(target: ConnectorResult, source: ConnectorResult | null | undefined) {
  if (!source) return;
  if (source.text) appendField(target, 'text', source.text);
  if (source.reasoning) appendField(target, 'reasoning', source.reasoning);
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
