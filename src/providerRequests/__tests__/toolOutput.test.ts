import { describe, expect, it } from 'vitest';
import { toolContextText, toolOutputText } from '../toolOutput';
import type { Message } from '../../types';

function inputOnlyToolMessage(): Message {
  return {
    id: 'tool',
    role: 'tool',
    text: '',
    toolCall: { name: 'web_search', input: { query: 'weather' } },
  };
}

describe('toolOutputText / toolContextText fallback when no output is present', () => {
  it('toolOutputText returns an empty string instead of echoing the input arguments', () => {
    const message = inputOnlyToolMessage();

    const rendered = toolOutputText(message);

    expect(rendered).toBe('');
    expect(rendered).not.toContain('weather');
    expect(rendered).not.toContain('query');
  });

  it('toolOutputText still surfaces the message text when output is absent but text is present', () => {
    const message: Message = {
      id: 'tool',
      role: 'tool',
      text: 'partial streaming output',
      toolCall: { name: 'web_search', input: { query: 'weather' } },
    };

    expect(toolOutputText(message)).toBe('partial streaming output');
  });

  it('toolOutputText renders the output when explicitly set, even alongside an input', () => {
    const message: Message = {
      id: 'tool',
      role: 'tool',
      text: '',
      toolCall: { name: 'web_search', input: { query: 'weather' }, output: { ok: true } },
    };

    expect(toolOutputText(message)).toBe('{\n  "ok": true\n}');
  });

  it('toolContextText emits an empty Output (never the input) when there is no output and no text', () => {
    const message = inputOnlyToolMessage();

    const context = toolContextText(message);

    expect(context).toBe('Tool call web_search\nInput:\n{\n  "query": "weather"\n}\nOutput:\n');
    expect(context).not.toMatch(/Output:\n\{\s*"query"/);
  });
});
