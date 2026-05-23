import { describe, expect, it } from 'vitest';
import { PRICING } from '../pricing';

describe('PRICING table', () => {
  it('exposes input/output rates for at least one OpenAI, Anthropic, and Gemini model', () => {
    expect(PRICING['gpt-4o']).toBeDefined();
    expect(PRICING['claude-opus-4-7']).toBeDefined();
    expect(PRICING['gemini-2.5-pro']).toBeDefined();
  });

  it('uses USD per 1k tokens with finite, non-negative numbers throughout', () => {
    for (const [model, rates] of Object.entries(PRICING)) {
      expect(typeof rates.in).toBe('number');
      expect(typeof rates.out).toBe('number');
      expect(Number.isFinite(rates.in)).toBe(true);
      expect(Number.isFinite(rates.out)).toBe(true);
      expect(rates.in).toBeGreaterThanOrEqual(0);
      expect(rates.out).toBeGreaterThanOrEqual(0);
      // A sanity ceiling: published per-1k token rates should never be in the
      // hundreds. This catches a stale entry that accidentally used `per
      // million` units (so the cost meter doesn't suddenly show $1000+).
      expect(rates.in).toBeLessThan(1);
      expect(rates.out).toBeLessThan(1);
      expect(model.length).toBeGreaterThan(0);
    }
  });
});
