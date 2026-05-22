import type { ChorusSourceLabels } from './types';

export const DEFAULT_SOURCE_LABELS: ChorusSourceLabels = {
  sources: 'Sources',
  source: (index) => `Source ${index + 1}`,
};
