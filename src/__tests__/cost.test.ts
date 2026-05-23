import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import {
  computeConversationCost,
  computeUsageCost,
  formatCostChip,
  formatUsd,
  readMessageModelId,
  readMessageUsage,
} from '../utils/cost';
import { PRICING } from '../pricing';

function asMessage(partial: Partial<Message> & { id: string; role: Message['role'] }): Message {
  // Test fixture: builds a minimally-typed message so each test can focus on the
  // shape under test (role + metadata) without restating defaults.
  return { text: '', ...partial } as Message;
}

describe('formatUsd', () => {
  it('renders 0 as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('renders sub-cent values with three fractional digits', () => {
    expect(formatUsd(0.00345)).toBe('$0.003');
  });

  it('renders >=$0.01 values with two fractional digits', () => {
    expect(formatUsd(0.4321)).toBe('$0.43');
    expect(formatUsd(2.5)).toBe('$2.50');
  });
});

describe('formatCostChip', () => {
  it('joins cost and token count with a middle dot', () => {
    expect(formatCostChip({ usd: 0.0125, tokens: 1234 })).toBe('$0.01 · 1,234 tok');
  });

  it('omits the cost when 0 and tokens > 0', () => {
    expect(formatCostChip({ usd: 0, tokens: 412 })).toBe('412 tok');
  });

  it('omits the tokens when 0', () => {
    expect(formatCostChip({ usd: 0.5, tokens: 0 })).toBe('$0.50');
  });
});

describe('computeUsageCost', () => {
  it('computes prompt+completion USD using a pricing entry', () => {
    const usage = { promptTokens: 1000, completionTokens: 2000 };
    const pricing = { in: 0.003, out: 0.015 };
    expect(computeUsageCost(usage, pricing)).toBeCloseTo(0.003 + 0.03, 6);
  });

  it('falls back to totalTokens - promptTokens when completionTokens is missing', () => {
    const usage = { promptTokens: 500, totalTokens: 1500 };
    const pricing = { in: 0.001, out: 0.002 };
    expect(computeUsageCost(usage, pricing)).toBeCloseTo((500 * 0.001 + 1000 * 0.002) / 1000, 6);
  });

  it('returns 0 when either usage or pricing is undefined', () => {
    expect(computeUsageCost(undefined, { in: 1, out: 1 })).toBe(0);
    expect(computeUsageCost({ promptTokens: 100 }, undefined)).toBe(0);
  });
});

describe('readMessageUsage', () => {
  it('reads a normalized usage object from metadata.usage', () => {
    const message = asMessage({
      id: 'a',
      role: 'assistant',
      metadata: { usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } },
    });
    expect(readMessageUsage(message)).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
  });

  it('drops non-finite or negative fields', () => {
    const message = asMessage({
      id: 'a',
      role: 'assistant',
      metadata: { usage: { promptTokens: -5, completionTokens: Number.NaN, totalTokens: 42 } },
    });
    expect(readMessageUsage(message)).toEqual({ totalTokens: 42 });
  });

  it('returns undefined when no usage payload is present', () => {
    expect(readMessageUsage(asMessage({ id: 'a', role: 'assistant' }))).toBeUndefined();
    expect(readMessageUsage(asMessage({ id: 'a', role: 'assistant', metadata: {} }))).toBeUndefined();
  });
});

describe('readMessageModelId', () => {
  it('prefers metadata.modelId over the fallback', () => {
    const message = asMessage({ id: 'a', role: 'assistant', metadata: { modelId: 'gpt-4o' } });
    expect(readMessageModelId(message, 'gpt-4o-mini')).toBe('gpt-4o');
  });

  it('falls back when metadata.modelId is missing', () => {
    const message = asMessage({ id: 'a', role: 'assistant', metadata: {} });
    expect(readMessageModelId(message, 'gpt-4o-mini')).toBe('gpt-4o-mini');
  });

  it('returns undefined when neither is set', () => {
    expect(readMessageModelId(asMessage({ id: 'a', role: 'assistant' }))).toBeUndefined();
  });
});

describe('computeConversationCost', () => {
  const baseMessages: Message[] = [
    asMessage({ id: 'u1', role: 'user', text: 'hello' }),
    asMessage({
      id: 'a1',
      role: 'assistant',
      text: 'world',
      metadata: {
        modelId: 'gpt-4o',
        usage: { promptTokens: 100, completionTokens: 200 },
      },
    }),
    asMessage({
      id: 'a2',
      role: 'assistant',
      text: 'more',
      metadata: {
        modelId: 'gpt-4o-mini',
        usage: { promptTokens: 50, completionTokens: 50 },
      },
    }),
  ];

  it('aggregates totals across assistant messages and groups by model', () => {
    const result = computeConversationCost({ messages: baseMessages, pricing: PRICING });
    expect(result.total).toBeCloseTo(
      computeUsageCost({ promptTokens: 100, completionTokens: 200 }, PRICING['gpt-4o']!)
        + computeUsageCost({ promptTokens: 50, completionTokens: 50 }, PRICING['gpt-4o-mini']!),
      6,
    );
    expect(result.perModel['gpt-4o']).toBeGreaterThan(0);
    expect(result.perModel['gpt-4o-mini']).toBeGreaterThan(0);
    expect(result.byMessageId.a1?.modelId).toBe('gpt-4o');
    expect(result.byMessageId.a2?.tokens).toBe(100);
  });

  it('skips messages with no usage and no override', () => {
    const messages: Message[] = [
      asMessage({ id: 'a1', role: 'assistant', text: 'no usage', metadata: { modelId: 'gpt-4o' } }),
    ];
    const result = computeConversationCost({ messages, pricing: PRICING });
    expect(result.total).toBe(0);
    expect(Object.keys(result.byMessageId)).toHaveLength(0);
  });

  it('honors costEstimator overrides per message', () => {
    const messages: Message[] = [
      asMessage({ id: 'a1', role: 'assistant', text: 'x', metadata: { modelId: 'gpt-4o' } }),
    ];
    const result = computeConversationCost({
      messages,
      pricing: PRICING,
      costEstimator: () => 1.23,
    });
    expect(result.total).toBe(1.23);
    expect(result.byMessageId.a1?.usd).toBe(1.23);
  });

  it('uses defaultModelId when a message has no metadata.modelId', () => {
    const messages: Message[] = [
      asMessage({
        id: 'a1',
        role: 'assistant',
        text: 'x',
        metadata: { usage: { promptTokens: 1000, completionTokens: 1000 } },
      }),
    ];
    const result = computeConversationCost({
      messages,
      pricing: PRICING,
      defaultModelId: 'gpt-4o-mini',
    });
    expect(result.byMessageId.a1?.modelId).toBe('gpt-4o-mini');
    expect(result.perModel['gpt-4o-mini']).toBeGreaterThan(0);
  });
});
