import type { MessageCost } from '../../utils/cost';
import { formatCostChip } from '../../utils/cost';

export interface MessageCostChipProps {
  cost?: MessageCost;
  /** When true the chip renders with an approximate marker — used for live, pre-`done` estimates. */
  approximate?: boolean;
  /** Tooltip text (e.g. live-estimate explanation). Falls back to the model id. */
  title?: string;
}

/**
 * Tiny `$0.003 · 412 tok` chip rendered at the bottom-right of an assistant
 * bubble when `<Chorus showCost>` is on. Renders nothing when the message
 * has no `cost` payload, so it is safe to drop into every bubble and let the
 * data decide visibility.
 */
export function MessageCostChip({ cost, approximate = false, title }: MessageCostChipProps) {
  if (!cost) return null;
  if (cost.tokens === 0 && cost.usd === 0) return null;
  const label = formatCostChip(cost);
  const tooltip = title ?? cost.modelId;
  return (
    <span
      className="chorus-cost-chip"
      data-chorus-cost-approximate={approximate ? 'true' : undefined}
      title={tooltip}
      aria-label={`Cost: ${label}${approximate ? ' (approximate)' : ''}`}
    >
      {approximate ? `~${label}` : label}
    </span>
  );
}
