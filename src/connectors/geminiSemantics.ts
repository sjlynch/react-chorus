/**
 * Gemini provider-semantics constants, predicates, and messaging helpers.
 * Separate from `gemini.ts` so the SSE wire-parsing (`extract`, candidate
 * selection, tool-delta extraction) stays focused on stream shape, while
 * meaning-of-finish-reasons / safety-rating ranking lives here.
 */

export const DEFAULT_CANDIDATE_INDEX = 0;

const NORMAL_FINISH_REASONS = new Set(['STOP', 'MAX_TOKENS']);
const UNSPECIFIED_FINISH_REASONS = new Set(['FINISH_REASON_UNSPECIFIED', 'UNSPECIFIED']);

const SAFETY_PROBABILITY_RANK: Record<string, number> = {
  NEGLIGIBLE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

export function isUnspecifiedFinishReason(finishReason: unknown): finishReason is string {
  return typeof finishReason === 'string' && UNSPECIFIED_FINISH_REASONS.has(finishReason);
}

export function isBlockingFinishReason(finishReason: unknown): finishReason is string {
  if (typeof finishReason !== 'string' || !finishReason) return false;
  return !NORMAL_FINISH_REASONS.has(finishReason) && !UNSPECIFIED_FINISH_REASONS.has(finishReason);
}

export function isDoneFinishReason(finishReason: unknown): finishReason is string {
  return typeof finishReason === 'string' && NORMAL_FINISH_REASONS.has(finishReason);
}

export function geminiBlockedMessage(finishReason: string, hasText: boolean, worstCategory?: string) {
  const base = hasText
    ? `Gemini response ended with blocked finishReason: ${finishReason}`
    : `Gemini response was blocked and returned no text (finishReason: ${finishReason})`;
  return worstCategory ? `${base} (worst category: ${worstCategory})` : base;
}

/**
 * Pick the highest-severity safety rating from a `candidate.safetyRatings` array. Returns the
 * category string of the rating with the largest `probability` (or the first `blocked: true`
 * rating, which trumps probability). Used to enrich blocked-finish-reason error messages.
 */
export function findWorstSafetyCategory(safetyRatings: unknown): string | undefined {
  if (!Array.isArray(safetyRatings) || safetyRatings.length === 0) return undefined;
  let worstCategory: string | undefined;
  let worstRank = -1;
  for (const rating of safetyRatings) {
    if (!rating || typeof rating !== 'object') continue;
    const r = rating as Record<string, unknown>;
    const category = typeof r.category === 'string' ? r.category : undefined;
    if (!category) continue;
    if (r.blocked === true) return category;
    const probability = typeof r.probability === 'string' ? r.probability : undefined;
    const rank = probability ? SAFETY_PROBABILITY_RANK[probability] ?? -1 : -1;
    if (rank > worstRank) {
      worstRank = rank;
      worstCategory = category;
    }
  }
  return worstCategory;
}
