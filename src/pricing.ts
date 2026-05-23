/**
 * Built-in model pricing table used by the cost meter (`<Chorus showCost>` /
 * `<Chorus budgetAlert>`). USD per **1k tokens**, separated by input vs
 * output. Importable from the `react-chorus/pricing` subpath so consumers can
 * read the same numbers Chorus uses, or build a custom snapshot:
 *
 * ```ts
 * import { PRICING, type ModelPricing } from 'react-chorus/pricing';
 * const myTable: Record<string, ModelPricing> = { ...PRICING, 'my-model': { in: 0, out: 0 } };
 * ```
 *
 * ## Freshness
 *
 * Provider prices change. This table is a **best-effort snapshot** taken at
 * release time, not a live feed — treat it as a default that lets the meter
 * surface a plausible number out of the box. Production apps SHOULD pass
 * their own table via `<Chorus pricing={...}>` (the host map is merged on
 * top of `PRICING`, so partial overrides win per model without dropping the
 * defaults for unmentioned models).
 *
 * `scripts/update-pricing.mjs` can be wired to a CI cron to refresh this
 * file from the published provider pages; see the script header for the
 * scrape sources.
 */
export interface ModelPricing {
  /** USD per 1k input/prompt tokens. */
  in: number;
  /** USD per 1k output/completion tokens. */
  out: number;
}

export type PricingTable = Record<string, ModelPricing>;

/**
 * Snapshot pricing in USD per 1k tokens. Keys are the model id strings
 * providers return in `usage`-bearing responses. Override per-model via
 * `<Chorus pricing={{...}}>` — partial overrides merge on top of these
 * defaults, so an entry here is only used when the host did not supply one.
 *
 * Last reviewed: 2026-05.
 */
export const PRICING: PricingTable = {
  // OpenAI
  'gpt-4o': { in: 0.0025, out: 0.01 },
  'gpt-4o-mini': { in: 0.00015, out: 0.0006 },
  'gpt-4.1': { in: 0.002, out: 0.008 },
  'gpt-4.1-mini': { in: 0.0004, out: 0.0016 },
  'gpt-4.1-nano': { in: 0.0001, out: 0.0004 },
  'o1': { in: 0.015, out: 0.06 },
  'o1-mini': { in: 0.003, out: 0.012 },
  'o3': { in: 0.002, out: 0.008 },
  'o3-mini': { in: 0.0011, out: 0.0044 },
  'o4-mini': { in: 0.0011, out: 0.0044 },
  // Anthropic
  'claude-opus-4-7': { in: 0.015, out: 0.075 },
  'claude-opus-4-6': { in: 0.015, out: 0.075 },
  'claude-sonnet-4-6': { in: 0.003, out: 0.015 },
  'claude-haiku-4-5': { in: 0.0008, out: 0.004 },
  'claude-3-5-sonnet': { in: 0.003, out: 0.015 },
  'claude-3-5-haiku': { in: 0.0008, out: 0.004 },
  'claude-3-opus': { in: 0.015, out: 0.075 },
  // Google Gemini
  'gemini-2.5-pro': { in: 0.00125, out: 0.005 },
  'gemini-2.5-flash': { in: 0.000075, out: 0.0003 },
  'gemini-1.5-pro': { in: 0.00125, out: 0.005 },
  'gemini-1.5-flash': { in: 0.000075, out: 0.0003 },
};
