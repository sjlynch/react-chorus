import { describe, expect, it } from 'vitest';
import { toGeminiContents } from '../gemini';
import type { Message } from '../../types';

describe('Gemini functionResponse fallback when no output is present', () => {
  it('does not echo toolCall.input as the functionResponse.response payload', () => {
    const history: Message[] = [
      {
        id: 'tool',
        role: 'tool',
        text: '',
        toolCall: { name: 'lookup', input: { foo: 'bar' } },
      },
    ];

    const contents = toGeminiContents(history);

    expect(contents).toEqual([
      { role: 'model', parts: [{ functionCall: { name: 'lookup', args: { foo: 'bar' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'lookup', response: { content: '' } } }] },
    ]);

    const serialized = JSON.stringify(contents[1]);
    expect(serialized).not.toContain('foo');
    expect(serialized).not.toContain('bar');
  });

  it('still surfaces the message text when output is absent but text is present', () => {
    const history: Message[] = [
      {
        id: 'tool',
        role: 'tool',
        text: 'partial streaming output',
        toolCall: { name: 'lookup', input: { foo: 'bar' } },
      },
    ];

    expect(toGeminiContents(history)).toEqual([
      { role: 'model', parts: [{ functionCall: { name: 'lookup', args: { foo: 'bar' } } }] },
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'lookup', response: { content: 'partial streaming output' } } }],
      },
    ]);
  });

  it('falls back to safe text context instead of throwing on a tool message with no toolCall', () => {
    // `ToolMessage.toolCall` is required at the type level, but the request
    // mappers tolerate loose runtime history (raw JSON, hand-built entries, a
    // connector bug). A `{ role: 'tool' }` entry with no `toolCall` must reach
    // the guarded text fallback, not crash inside `extractToolBlock`.
    const history = [
      { id: 'tool', role: 'tool', text: 'tool ran but lost its call' },
    ] as Message[];

    expect(() => toGeminiContents(history)).not.toThrow();
    expect(toGeminiContents(history)).toEqual([
      { role: 'user', parts: [{ text: 'Tool result:\ntool ran but lost its call' }] },
    ]);
  });

  it('honors an explicit toolCall.output of null instead of falling back to message text', () => {
    // A tool that legitimately returned null. `hasOwn` (via the shared
    // `toolOutputValue` helper) must use the explicit null rather than echoing
    // the streamed message text, matching OpenAI/Anthropic value resolution.
    const history: Message[] = [
      {
        id: 'tool',
        role: 'tool',
        text: 'streamed text that must be ignored once output is set',
        toolCall: { name: 'lookup', input: { foo: 'bar' }, output: null },
      },
    ];

    expect(toGeminiContents(history)).toEqual([
      { role: 'model', parts: [{ functionCall: { name: 'lookup', args: { foo: 'bar' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'lookup', response: { content: '' } } }] },
    ]);
  });
});
