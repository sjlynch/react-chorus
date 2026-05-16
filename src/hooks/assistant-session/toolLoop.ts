import { warnOnceInDev } from '../../utils/warnings';

export const DEFAULT_MAX_TOOL_ITERATIONS = 4;

export function normalizeMaxToolIterations(value: unknown): number {
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  warnOnceInDev(
    'invalid-max-tool-iterations',
    '[Chorus] `maxToolIterations` must be a non-negative finite number, or `Infinity` to explicitly disable the automatic tool-loop cap. Falling back to the default of 4.',
  );
  return DEFAULT_MAX_TOOL_ITERATIONS;
}
