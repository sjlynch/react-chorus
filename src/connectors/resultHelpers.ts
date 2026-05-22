import type { MessageSource } from '../types';
import type { ConnectorResult, ConnectorToolDelta } from './types';

export function appendField(target: ConnectorResult, key: 'text' | 'reasoning', value: string) {
  if (!value) return;
  target[key] = `${target[key] ?? ''}${value}`;
}

export function appendSource(target: ConnectorResult, source: MessageSource) {
  if (!target.source) {
    target.source = source;
    return;
  }

  if (!target.sources) target.sources = [target.source];
  target.sources.push(source);
}

export function appendToolDelta(target: ConnectorResult, toolDelta: ConnectorToolDelta) {
  if (!target.toolDelta) {
    target.toolDelta = toolDelta;
    return;
  }

  if (!target.toolDeltas) target.toolDeltas = [target.toolDelta];
  target.toolDeltas.push(toolDelta);
}

export function hasSource(result: ConnectorResult) {
  return Boolean(result.source || result.sources?.length);
}

export function hasToolDelta(result: ConnectorResult) {
  return Boolean(result.toolDelta || result.toolDeltas?.length);
}
