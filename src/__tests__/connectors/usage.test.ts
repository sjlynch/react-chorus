import { describe, it, expect } from 'vitest';
import { extractUsage } from '../../connectors/usage';

describe('extractUsage', () => {
  it('normalizes OpenAI Chat Completions field names', () => {
    expect(extractUsage({ prompt_tokens: 11, completion_tokens: 6, total_tokens: 17 })).toEqual({
      promptTokens: 11,
      completionTokens: 6,
      totalTokens: 17,
    });
  });

  it('normalizes OpenAI Responses / Anthropic field names', () => {
    expect(extractUsage({ input_tokens: 12, output_tokens: 7, total_tokens: 19 })).toEqual({
      promptTokens: 12,
      completionTokens: 7,
      totalTokens: 19,
    });
  });

  it('normalizes Gemini usageMetadata field names', () => {
    expect(extractUsage({ promptTokenCount: 18, candidatesTokenCount: 24, totalTokenCount: 42 })).toEqual({
      promptTokens: 18,
      completionTokens: 24,
      totalTokens: 42,
    });
  });

  it('normalizes Vercel AI SDK v4 field names (promptTokens / completionTokens)', () => {
    expect(extractUsage({ promptTokens: 18, completionTokens: 24, totalTokens: 42 })).toEqual({
      promptTokens: 18,
      completionTokens: 24,
      totalTokens: 42,
    });
  });

  it('normalizes Vercel AI SDK v5 field names (inputTokens / outputTokens)', () => {
    expect(extractUsage({ inputTokens: 12, outputTokens: 7, totalTokens: 19 })).toEqual({
      promptTokens: 12,
      completionTokens: 7,
      totalTokens: 19,
    });
  });

  it('keeps only the token counts that are present', () => {
    expect(extractUsage({ output_tokens: 5 })).toEqual({ completionTokens: 5 });
  });

  it('returns undefined for a non-object or nullish payload', () => {
    expect(extractUsage(undefined)).toBeUndefined();
    expect(extractUsage(null)).toBeUndefined();
    expect(extractUsage('usage')).toBeUndefined();
  });

  it('returns undefined when no recognised token count is present', () => {
    expect(extractUsage({})).toBeUndefined();
    expect(extractUsage({ unrelated: 1 })).toBeUndefined();
  });

  it('ignores non-finite and non-numeric token values', () => {
    expect(extractUsage({ prompt_tokens: Number.NaN, completion_tokens: '7', total_tokens: Infinity })).toBeUndefined();
  });
});
