import type { ChorusCostLabels } from './types';

export const DEFAULT_COST_LABELS: ChorusCostLabels = {
  header: 'Cost',
  noUsage: 'No usage data yet.',
  budgetSuffix: (formattedBudget) => `/ ${formattedBudget} budget`,
  chipAriaLabel: ({ formatted, approximate }) => `Cost: ${formatted}${approximate ? ' (approximate)' : ''}`,
  liveEstimateTitle: 'Live estimate — usage not finalized yet',
};
