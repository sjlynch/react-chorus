import { appendField, appendToolDelta, hasToolDelta } from '../resultHelpers';
import type { ConnectorResult, ConnectorWarning } from '../types';

// Re-exported so Gemini parser modules importing these from `result.ts` keep working.
export { appendField, appendToolDelta, hasToolDelta };

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
