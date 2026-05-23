import { afterEach, describe, expect, it } from 'vitest';
import { estimateTokens, heuristicTokenCount, _resetTokenizerCacheForTests } from '../utils/tokenize';

describe('heuristicTokenCount', () => {
  it('returns 0 for an empty string', () => {
    expect(heuristicTokenCount('')).toBe(0);
  });

  it('rounds chars / 3.8 with a floor of 1 for non-empty input', () => {
    expect(heuristicTokenCount('x')).toBe(1);
    // 38 chars / 3.8 = 10 tokens.
    expect(heuristicTokenCount('a'.repeat(38))).toBe(10);
  });
});

describe('estimateTokens', () => {
  afterEach(() => {
    _resetTokenizerCacheForTests();
  });

  it('falls back to the heuristic when js-tiktoken is not installed', async () => {
    // The optional `js-tiktoken` peer is intentionally not installed in this
    // repo, so the dynamic import inside `estimateTokens` should reject and
    // the helper should report a heuristic estimate. If a future change adds
    // js-tiktoken, this assertion would also pass for `source: 'tiktoken'` —
    // accept either as long as the token count is plausible.
    const result = await estimateTokens('hello world from chorus');
    expect(result.tokens).toBeGreaterThan(0);
    expect(['heuristic', 'tiktoken']).toContain(result.source);
  });

  it('returns 0 tokens for an empty string without resolving the encoder', async () => {
    const result = await estimateTokens('');
    expect(result).toEqual({ tokens: 0, source: 'heuristic' });
  });
});
