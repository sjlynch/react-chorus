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

  it('applies options only to the "openai" connector and warns once per ignoring connector', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const options = { thinkTag: { start: '<r>', end: '</r>' } };

    // Non-openai connectors do not consume options: the connector is unchanged
    // and a single dev warning explains the ignored argument, deduped per target.
    expect(getConnector('anthropic', options).name).toBe('anthropic');
    getConnector('anthropic', options); // deduped — no second warning
    getConnector(undefined, options); // default auto connector
    getConnector({ name: 'custom', extract: vi.fn() }, options); // custom object

    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the `anthropic` connector does not accept them'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the default `auto` connector does not accept them'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Chorus has no mechanism to forward connector options to a custom connector object'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("only apply to `getConnector('openai', ...)`"));

    // The "openai" connector consumes options without warning.
    expect(getConnector('openai', options).name).toBe('openai');
    expect(warn).toHaveBeenCalledTimes(3);

    warn.mockRestore();
  });

  it('emits only the unknown-connector warning for an unknown name passed with options', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // A typo'd connector name with options must NOT also get the generic
    // "the `opena` connector does not accept them" warning — that wording
    // implies a real connector named after the typo. Exactly one coherent
    // warning fires, and it names `auto` as the connector actually returned.
    // @ts-expect-error intentional unknown string
    expect(getConnector('opena', { thinkTag: { start: '<r>', end: '</r>' } })).toBe(autoConnector);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown connector `opena`'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('falling back to `auto`'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('does not accept them'));

    warn.mockRestore();
  });
});
