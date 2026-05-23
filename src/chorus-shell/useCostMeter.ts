import React from 'react';
import type { Message } from '../types';
import type { ChorusMessagesChangeReason } from '../hooks/useChorusMessages';
import type { ConversationCost } from '../utils/cost';
import { computeConversationCost } from '../utils/cost';
import { PRICING, type PricingTable } from '../pricing';

export interface BudgetExceededContext {
  /** Conversation total in USD that crossed the threshold. */
  total: number;
  /** Per-model breakdown at the moment the threshold was crossed. */
  perModel: Record<string, number>;
  /** Threshold value that was crossed. */
  threshold: number;
}

interface UpdateMsgsOptions {
  reason?: ChorusMessagesChangeReason;
}

export interface UseCostMeterOptions<TMeta> {
  enabled: boolean;
  messages: Message<TMeta>[];
  /**
   * Ref to the currently-streaming assistant message id. Passed by ref so the
   * caller can keep updating it as the session progresses without changing
   * the identity of the wrapped `onStreamMetadata` callback (which would
   * otherwise force `useAssistantSession` to re-bind every render).
   */
  streamingMessageIdRef: React.MutableRefObject<string | null>;
  /** Host-supplied pricing overrides. Merged on top of the built-in `PRICING` table. */
  pricing?: PricingTable;
  /** Fallback model id used when a message has no `metadata.modelId`. */
  defaultModelId?: string;
  /** Optional per-message override for the cost calculation. */
  costEstimator?: (message: Message<TMeta>, modelId: string | undefined) => number | undefined;
  /** Budget threshold in USD. Once `total` strictly exceeds this, `onBudgetExceeded` fires exactly once. */
  budgetAlert?: number;
  onBudgetExceeded?: (context: BudgetExceededContext) => void;
  /** Host's own `onStreamMetadata`. The wrapped version calls this first, then attaches usage to the active message. */
  onStreamMetadata?: (metadata: Record<string, unknown>) => void;
  updateMessages: (
    updater: (prev: Message<TMeta>[]) => Message<TMeta>[],
    options?: UpdateMsgsOptions,
  ) => Message<TMeta>[];
}

export interface UseCostMeterResult {
  cost: ConversationCost;
  /** Wrapped `onStreamMetadata` callback to forward to the assistant session. */
  onStreamMetadata?: (metadata: Record<string, unknown>) => void;
}

function isPositiveFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function extractUsageFromMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const usage = metadata.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  return usage as Record<string, unknown>;
}

function attachUsageToMessage<TMeta>(
  messages: Message<TMeta>[],
  streamingId: string,
  usage: Record<string, unknown>,
  modelId: string | undefined,
): Message<TMeta>[] {
  let touched = false;
  const next = messages.map(message => {
    if (message.id !== streamingId || message.role !== 'assistant') return message;
    touched = true;
    const existingMeta = (message.metadata ?? {}) as Record<string, unknown>;
    const nextMeta: Record<string, unknown> = { ...existingMeta, usage };
    if (modelId && !existingMeta.modelId) nextMeta.modelId = modelId;
    return { ...message, metadata: nextMeta as typeof message.metadata };
  });
  return touched ? next : messages;
}

/**
 * Internal cost-meter hook. When `enabled` is true it:
 *
 * 1. Wraps `onStreamMetadata` so each connector-emitted `usage` payload is
 *    written onto the currently-streaming assistant message's `metadata.usage`.
 *    The original host callback still fires first.
 * 2. Aggregates conversation totals via `computeConversationCost`, merging
 *    the host's `pricing` on top of the built-in `PRICING` snapshot.
 * 3. Fires `onBudgetExceeded` exactly once per crossing — re-arms only when
 *    the running total drops back at or below the threshold.
 */
export function useCostMeter<TMeta>({
  enabled,
  messages,
  streamingMessageIdRef,
  pricing,
  defaultModelId,
  costEstimator,
  budgetAlert,
  onBudgetExceeded,
  onStreamMetadata,
  updateMessages,
}: UseCostMeterOptions<TMeta>): UseCostMeterResult {
  const defaultModelIdRef = React.useRef(defaultModelId);
  defaultModelIdRef.current = defaultModelId;
  const onStreamMetadataRef = React.useRef(onStreamMetadata);
  onStreamMetadataRef.current = onStreamMetadata;
  const updateMessagesRef = React.useRef(updateMessages);
  updateMessagesRef.current = updateMessages;

  const mergedPricing = React.useMemo<PricingTable>(() => {
    if (!pricing) return PRICING;
    return { ...PRICING, ...pricing };
  }, [pricing]);

  const cost = React.useMemo<ConversationCost>(() => {
    if (!enabled) return { total: 0, perModel: {}, byMessageId: {} };
    return computeConversationCost<TMeta>({
      messages,
      pricing: mergedPricing,
      defaultModelId,
      costEstimator,
    });
  }, [enabled, messages, mergedPricing, defaultModelId, costEstimator]);

  const exceededLatchedRef = React.useRef(false);
  const onBudgetExceededRef = React.useRef(onBudgetExceeded);
  onBudgetExceededRef.current = onBudgetExceeded;

  React.useEffect(() => {
    if (!enabled || !isPositiveFinite(budgetAlert)) {
      exceededLatchedRef.current = false;
      return;
    }
    if (cost.total > budgetAlert) {
      if (exceededLatchedRef.current) return;
      exceededLatchedRef.current = true;
      try {
        onBudgetExceededRef.current?.({ total: cost.total, perModel: cost.perModel, threshold: budgetAlert });
      } catch {
        // Observer; never let host errors interrupt rendering.
      }
    } else if (cost.total <= budgetAlert) {
      // Re-arm so a later increase past the threshold fires again. This
      // matters for hosts that reset/clear the conversation: a cleared
      // total of 0 should reset the latch so the next over-budget run
      // still alerts.
      exceededLatchedRef.current = false;
    }
  }, [enabled, budgetAlert, cost]);

  const wrappedOnStreamMetadata = React.useCallback((metadata: Record<string, unknown>) => {
    onStreamMetadataRef.current?.(metadata);
    if (!enabled) return;
    const usage = extractUsageFromMetadata(metadata);
    if (!usage) return;
    const streamingId = streamingMessageIdRef.current;
    if (!streamingId) return;
    const modelId = typeof metadata.modelId === 'string'
      ? metadata.modelId
      : typeof metadata.model === 'string'
        ? metadata.model
        : defaultModelIdRef.current;
    updateMessagesRef.current(prev => attachUsageToMessage(prev, streamingId, usage, modelId), { reason: 'update' });
  }, [enabled, streamingMessageIdRef]);

  // Only forward the wrapper when the meter is on OR the host wired its own
  // observer — otherwise let `undefined` propagate so the session keeps its
  // existing "no callback registered" optimization.
  const forwardedOnStreamMetadata = enabled || onStreamMetadata ? wrappedOnStreamMetadata : undefined;

  return { cost, onStreamMetadata: forwardedOnStreamMetadata };
}
