import type { ConnectorResult, ConnectorToolDelta, ConnectorWarning } from '../types';

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

/**
 * Append a non-fatal warning to a connector result. Warnings accumulate in `warnings` so a
 * single chunk can surface several independent diagnostics (e.g. an unsupported part *and*
 * truncation) instead of the second one clobbering the first. `warning` mirrors the first
 * warning for back-compat with consumers reading the legacy single slot.
 */
export function addWarning(target: ConnectorResult, warning: ConnectorWarning) {
  (target.warnings ??= []).push(warning);
  target.warning ??= warning;
}
