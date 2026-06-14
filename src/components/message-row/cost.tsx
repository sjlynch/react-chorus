import type { MessageCost } from '../../utils/cost';
import { formatCostChip } from '../../utils/cost';
import { DEFAULT_COST_LABELS } from '../../labels/cost';
import type { ChorusCostLabels } from '../../labels/types';

export interface MessageCostChipProps {
  cost?: MessageCost;
  /** When true the chip renders with an approximate marker — used for live, pre-`done` estimates. */
  approximate?: boolean;
  /** Tooltip text (e.g. live-estimate explanation). Falls back to the model id. */
  title?: string;
  /** Localized cost strings. Defaults to the built-in English labels. */
  labels?: ChorusCostLabels;
}

/**
 * Tiny `$0.003 · 412 tok` chip rendered at the bottom-right of an assistant
 * bubble when `<Chorus showCost>` is on. Renders nothing when the message
 * has no `cost` payload, so it is safe to drop into every bubble and let the
 * data decide visibility.
 */
export function MessageCostChip({ cost, approximate = false, title, labels = DEFAULT_COST_LABELS }: MessageCostChipProps) {
  if (!cost) return null;
  if (cost.tokens === 0 && cost.usd === 0) return null;
  const label = formatCostChip(cost);
  const tooltip = title ?? cost.modelId;
  return (
    <span
      className="chorus-cost-chip"
      data-chorus-cost-approximate={approximate ? 'true' : undefined}
      title={tooltip}
      aria-label={labels.chipAriaLabel({ formatted: label, approximate })}
    >
      {approximate ? `~${label}` : label}
    </span>
  );
}
