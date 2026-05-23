import type { Message } from '../types';
import type { ModelPricing, PricingTable } from '../pricing';

/**
 * Normalized usage shape consumed by the cost meter. Mirrors the
 * `{ promptTokens, completionTokens, totalTokens }` object connectors emit
 * through `metadata.usage` after running through `extractUsage`. All fields
 * are optional so a partial provider payload still surfaces what it carries.
 */
export interface CostUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface MessageCost {
  /** Total USD cost for this message ( `promptTokens * in/1k + completionTokens * out/1k` ). */
  usd: number;
  /** Token count surfaced under the chip ( `totalTokens ?? prompt + completion` ). */
  tokens: number;
  /** Resolved model id used to look up pricing, if any. */
  modelId?: string;
}

export interface ConversationCost {
  /** Sum of every assistant message's `usd`. */
  total: number;
  /** Per-model breakdown for the optional hover panel. Empty when no usage is available. */
  perModel: Record<string, number>;
  /** Per-message-id cost map so renderers can index without recomputing. */
  byMessageId: Record<string, MessageCost>;
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/**
 * Pull a normalized `CostUsage` off a message's `metadata.usage` field. The
 * built-in `onStreamMetadata` interceptor writes the shared
 * `{ promptTokens, completionTokens, totalTokens }` shape there after each
 * turn; a host with bespoke metadata can still wire `costEstimator` to read
 * its own shape and bypass this path.
 */
export function readMessageUsage(message: Message): CostUsage | undefined {
  const meta = message.metadata as Record<string, unknown> | undefined;
  const usage = meta?.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== 'object') return undefined;
  const out: CostUsage = {};
  if (isFinitePositive(usage.promptTokens)) out.promptTokens = usage.promptTokens;
  if (isFinitePositive(usage.completionTokens)) out.completionTokens = usage.completionTokens;
  if (isFinitePositive(usage.totalTokens)) out.totalTokens = usage.totalTokens;
  return out.promptTokens !== undefined || out.completionTokens !== undefined || out.totalTokens !== undefined
    ? out
    : undefined;
}

export function readMessageModelId(message: Message, fallback?: string): string | undefined {
  const meta = message.metadata as Record<string, unknown> | undefined;
  const id = meta?.modelId;
  if (typeof id === 'string' && id.length > 0) return id;
  return fallback;
}

/** Compute USD cost for a single usage payload + pricing entry. Returns 0 when either is missing. */
export function computeUsageCost(usage: CostUsage | undefined, pricing: ModelPricing | undefined): number {
  if (!usage || !pricing) return 0;
  const prompt = usage.promptTokens ?? 0;
  const completion = usage.completionTokens
    ?? (usage.totalTokens !== undefined && usage.promptTokens !== undefined
      ? Math.max(0, usage.totalTokens - usage.promptTokens)
      : 0);
  return (prompt * pricing.in + completion * pricing.out) / 1000;
}

function totalTokensFromUsage(usage: CostUsage | undefined): number {
  if (!usage) return 0;
  if (usage.totalTokens !== undefined) return usage.totalTokens;
  return (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
}

export interface ComputeConversationCostOptions<TMeta = Record<string, unknown>> {
  messages: Message<TMeta>[];
  pricing: PricingTable;
  /** Fallback model id used when a message has no `metadata.modelId`. */
  defaultModelId?: string;
  /** Host-supplied per-message override. Wins over the pricing-table lookup when it returns a finite number. */
  costEstimator?: (message: Message<TMeta>, modelId: string | undefined) => number | undefined;
}

/**
 * Compute conversation totals from the messages array. Iterates every
 * assistant message, reads its `metadata.usage` (or `costEstimator(message)`),
 * looks up pricing, and aggregates `total`, `perModel`, and `byMessageId`.
 * Pure — safe to call inside `useMemo`.
 */
export function computeConversationCost<TMeta = Record<string, unknown>>({
  messages,
  pricing,
  defaultModelId,
  costEstimator,
}: ComputeConversationCostOptions<TMeta>): ConversationCost {
  const byMessageId: Record<string, MessageCost> = {};
  const perModel: Record<string, number> = {};
  let total = 0;

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const modelId = readMessageModelId(message as Message, defaultModelId);
    const usage = readMessageUsage(message as Message);
    const override = costEstimator?.(message, modelId);
    const usd = typeof override === 'number' && Number.isFinite(override) && override >= 0
      ? override
      : computeUsageCost(usage, modelId ? pricing[modelId] : undefined);

    if (usd === 0 && !usage) continue;

    const tokens = totalTokensFromUsage(usage);
    byMessageId[message.id] = { usd, tokens, modelId };
    total += usd;
    if (modelId) perModel[modelId] = (perModel[modelId] ?? 0) + usd;
  }

  return { total, perModel, byMessageId };
}

/**
 * Format a small chip value like `$0.003 · 412 tok`. Cost is rendered with
 * adaptive precision so tiny fractions stay readable: `< $0.01` shows three
 * fractional digits, otherwise two. Tokens are shown as a thousands-grouped
 * integer with the `tok` suffix.
 */
export function formatCostChip(cost: MessageCost): string {
  const parts: string[] = [];
  if (cost.usd > 0 || cost.tokens === 0) {
    parts.push(formatUsd(cost.usd));
  }
  if (cost.tokens > 0) {
    parts.push(`${cost.tokens.toLocaleString('en-US')} tok`);
  }
  return parts.join(' · ');
}

export function formatUsd(usd: number): string {
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  if (usd > 0) return `$${usd.toFixed(3)}`;
  return '$0.00';
}
