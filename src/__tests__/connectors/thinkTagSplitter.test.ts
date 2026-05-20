import { describe, it, expect } from 'vitest';
import { compileThinkTags, createThinkTagSplitter } from '../../connectors/openai/thinkTagSplitter';

describe('createThinkTagSplitter', () => {
  it('splits a clean think tag pair', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('<think>plan</think>answer')).toEqual({ reasoning: 'plan', text: 'answer' });
  });

  it('handles partial tags spanning chunk boundaries', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('hello <thi')).toEqual({ text: 'hello ' });
    expect(splitter.feed('nk>plan</thi')).toEqual({ reasoning: 'plan' });
    expect(splitter.feed('nk>answer')).toEqual({ text: 'answer' });
  });

  it('flushes a buffered trailing partial tag as literal text at EOF', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('I <')).toEqual({ text: 'I ' });
    expect(splitter.flush()).toEqual({ text: '<' });
  });

  it('passes through no-tag text', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('plain text')).toEqual({ text: 'plain text' });
    expect(splitter.flush()).toEqual({});
  });

  it('matches the default tag pair case-insensitively', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('<Think>plan</Think>answer')).toEqual({ reasoning: 'plan', text: 'answer' });
  });

  it('matches mixed-case tags like <THINK>', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('hi <THINK>secret</THINK>bye')).toEqual({ reasoning: 'secret', text: 'hi bye' });
  });

  it('tolerates whitespace inside the angle brackets', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('< think >plan</ think >answer')).toEqual({ reasoning: 'plan', text: 'answer' });
  });

  it('supports a custom reasoning tag pair', () => {
    const splitter = createThinkTagSplitter(undefined, { start: '<reasoning>', end: '</reasoning>' });
    expect(splitter.feed('<reasoning>plan</reasoning>answer')).toEqual({ reasoning: 'plan', text: 'answer' });
  });

  it('does not split default <think> tags when configured with a custom pair', () => {
    const splitter = createThinkTagSplitter(undefined, { start: '<scratchpad>', end: '</scratchpad>' });
    expect(splitter.feed('<think>still text</think>after')).toEqual({ text: '<think>still text</think>after' });
  });

  it('respects caseInsensitive: false', () => {
    const splitter = createThinkTagSplitter(undefined, { caseInsensitive: false });
    expect(splitter.feed('<Think>plan</Think>answer')).toEqual({ text: '<Think>plan</Think>answer' });
  });

  it('accepts pre-compiled tags from compileThinkTags', () => {
    const compiled = compileThinkTags({ start: '<reasoning>', end: '</reasoning>' });
    const splitter = createThinkTagSplitter(undefined, compiled);
    expect(splitter.feed('<reasoning>plan</reasoning>answer')).toEqual({ reasoning: 'plan', text: 'answer' });
  });

  it('reuses one compiled tag set across many feeds without recompiling', () => {
    const RealRegExp = RegExp;
    let constructed = 0;
    class CountingRegExp extends RealRegExp {
      constructor(...args: ConstructorParameters<typeof RegExp>) {
        constructed++;
        super(...args);
      }
    }
    const originalRegExp = globalThis.RegExp;
    globalThis.RegExp = CountingRegExp as unknown as RegExpConstructor;
    try {
      const compiled = compileThinkTags();
      const afterCompile = constructed;
      const splitter = createThinkTagSplitter(undefined, compiled);
      for (let i = 0; i < 30; i++) splitter.feed(`chunk ${i} `);
      expect(constructed).toBe(afterCompile);
    } finally {
      globalThis.RegExp = originalRegExp;
    }
  });
});
