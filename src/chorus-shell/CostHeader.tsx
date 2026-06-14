import { formatUsd } from '../utils/cost';
import type { ConversationCost } from '../utils/cost';
import { DEFAULT_COST_LABELS } from '../labels/cost';
import type { ChorusCostLabels } from '../labels/types';

export interface CostHeaderProps {
  cost: ConversationCost;
  /** Optional budget threshold — when set, the header annotates over-budget state. */
  budget?: number;
  /** Localized cost-meter strings. Defaults to the built-in English labels. */
  labels?: ChorusCostLabels;
}

/**
 * Conversation cost meter rendered at the top of `<Chorus showCost>`. Shows
 * the running total plus a `title=` hover breakdown of per-model spend.
 *
 * Why the `title` panel rather than a flyout popover: the meter is a glanceable
 * affordance, and a popover would need focus management / outside-click logic
 * that this widget does not otherwise host. A native tooltip stays accessible
 * to keyboard and screen reader users without dragging in popover plumbing.
 */
export function CostHeader({ cost, budget, labels = DEFAULT_COST_LABELS }: CostHeaderProps) {
  const overBudget = budget !== undefined && cost.total > budget;
  const models = Object.entries(cost.perModel);
  const breakdown = models.length > 0
    ? models.map(([model, usd]) => `${model}: ${formatUsd(usd)}`).join('\n')
    : labels.noUsage;

  return (
    <div
      className="chorus-cost-header"
      data-chorus-cost-over-budget={overBudget ? 'true' : undefined}
      role="status"
      aria-live="polite"
    >
      <span className="chorus-cost-header-label">{labels.header}</span>
      <span className="chorus-cost-header-total" title={breakdown}>
        {formatUsd(cost.total)}
      </span>
      {budget !== undefined && (
        <span className="chorus-cost-header-budget">
          {labels.budgetSuffix(formatUsd(budget))}
        </span>
      )}
    </div>
  );
}
