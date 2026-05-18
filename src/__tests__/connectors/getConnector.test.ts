import { describe, it, expect, vi } from 'vitest';
import { openaiConnector } from '../../connectors/openai';
import { autoConnector, getConnector } from '../../connectors/connectors';
import type { Connector } from '../../connectors/connectors';

describe('getConnector', () => {
  it('returns autoConnector when called with no argument', () => {
    expect(getConnector()).toBe(autoConnector);
  });

  it('returns autoConnector for "auto"', () => {
    expect(getConnector('auto')).toBe(autoConnector);
  });

  it('returns openaiConnector for "openai"', () => {
    const c = getConnector('openai');
    expect(c.name).toBe('openai');
  });

  it('returns anthropicConnector for "anthropic"', () => {
    const c = getConnector('anthropic');
    expect(c.name).toBe('anthropic');
  });

  it('returns geminiConnector for "gemini"', () => {
    const c = getConnector('gemini');
    expect(c.name).toBe('gemini');
  });

  it('returns aiSdkConnector for "ai-sdk"', () => {
    const c = getConnector('ai-sdk');
    expect(c.name).toBe('ai-sdk');
  });

  it('returns a custom connector object as-is', () => {
    const custom: Connector = { name: 'custom', extract: vi.fn() };
    expect(getConnector(custom)).toBe(custom);
  });

  it('falls back to autoConnector for unknown string', () => {
    // @ts-expect-error intentional unknown string
    expect(getConnector('unknown-provider')).toBe(autoConnector);
  });

  it('returns a configured openai connector when called with options', () => {
    const connector = getConnector('openai', { thinkTag: { start: '<reasoning>', end: '</reasoning>' } });
    expect(connector).not.toBe(openaiConnector);
    expect(connector.name).toBe('openai');
    const data = JSON.stringify({ choices: [{ index: 0, delta: { content: '<reasoning>plan</reasoning>answer' } }] });
    expect(connector.extract(data)).toEqual({ reasoning: 'plan', text: 'answer' });
  });

  it('returns the default openaiConnector when no options are provided', () => {
    expect(getConnector('openai')).toBe(openaiConnector);
  });
});
