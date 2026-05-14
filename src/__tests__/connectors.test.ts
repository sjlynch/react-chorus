import { describe, it, expect, vi } from 'vitest';
import { openaiConnector } from '../connectors/openai';
import { anthropicConnector } from '../connectors/anthropic';
import { geminiConnector } from '../connectors/gemini';
import { autoConnector, getConnector } from '../connectors/connectors';
import type { Connector } from '../connectors/connectors';

// ---------------------------------------------------------------------------
// openaiConnector
// ---------------------------------------------------------------------------

describe('openaiConnector', () => {
  it('returns done for [DONE] sentinel', () => {
    expect(openaiConnector.extract('[DONE]')).toEqual({ done: true });
  });

  it('extracts text from a single choice delta', () => {
    const data = JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] });
    expect(openaiConnector.extract(data)).toEqual({ text: 'Hello' });
  });

  it('selects choice index 0 instead of concatenating alternatives', () => {
    const data = JSON.stringify({
      choices: [
        { index: 1, delta: { content: 'alternative' } },
        { index: 0, delta: { content: 'selected' } },
      ],
    });
    expect(openaiConnector.extract(data)).toEqual({ text: 'selected' });
  });

  it('extracts reasoning deltas', () => {
    const data = JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'thinking' } }] });
    expect(openaiConnector.extract(data)).toEqual({ reasoning: 'thinking' });
  });

  it('splits DeepSeek-style think tags out of text content', () => {
    const data = JSON.stringify({ choices: [{ index: 0, delta: { content: '<think>plan</think>answer' } }] });
    expect(openaiConnector.extract(data)).toEqual({ reasoning: 'plan', text: 'answer' });
    expect(openaiConnector.extract('[DONE]')).toEqual({ done: true });
  });

  it('extracts tool call deltas and keeps the provider id for argument chunks', () => {
    const state = openaiConnector.createState?.();
    const start = JSON.stringify({
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":' } }] },
      }],
    });
    const next = JSON.stringify({
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] },
      }],
    });

    expect(state).toBeDefined();
    expect(openaiConnector.extract(start, state)).toEqual({ toolDelta: { id: 'call_1', name: 'search', input: '{"q":' } });
    expect(openaiConnector.extract(next, state)).toEqual({ toolDelta: { id: 'call_1', input: '"test"}' } });
    expect(openaiConnector.extract('[DONE]', state)).toEqual({ done: true });
  });

  it('returns null for role-only delta (no content)', () => {
    const data = JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] });
    expect(openaiConnector.extract(data)).toBeNull();
  });

  it('returns null for empty choices array', () => {
    const data = JSON.stringify({ choices: [] });
    expect(openaiConnector.extract(data)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(openaiConnector.extract('')).toBeNull();
  });

  it('falls back to plain text for non-JSON input', () => {
    expect(openaiConnector.extract('just some text')).toEqual({ text: 'just some text' });
  });

  it('falls back to plain text for JSON without choices', () => {
    const data = JSON.stringify({ type: 'something' });
    expect(openaiConnector.extract(data)).toBeNull();
  });

  it('returns an in-band error payload', () => {
    expect(openaiConnector.extract(JSON.stringify({ error: 'upstream failed' }))).toEqual({ error: 'upstream failed' });
    expect(openaiConnector.extract(JSON.stringify({ error: { message: 'bad request' } }))).toEqual({ error: 'bad request' });
  });
});

// ---------------------------------------------------------------------------
// anthropicConnector
// ---------------------------------------------------------------------------

describe('anthropicConnector', () => {
  it('extracts text from content_block_delta / text_delta events', () => {
    const data = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: ' world' },
    });
    expect(anthropicConnector.extract(data)).toEqual({ text: ' world' });
  });

  it('returns done on message_stop', () => {
    const data = JSON.stringify({ type: 'message_stop' });
    expect(anthropicConnector.extract(data)).toEqual({ done: true });
  });

  it('returns null for content_block_start (no text yet)', () => {
    const data = JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    expect(anthropicConnector.extract(data)).toBeNull();
  });

  it('returns null for ping events', () => {
    const data = JSON.stringify({ type: 'ping' });
    expect(anthropicConnector.extract(data)).toBeNull();
  });

  it('returns null for message_start', () => {
    const data = JSON.stringify({ type: 'message_start', message: { id: 'msg_1', role: 'assistant' } });
    expect(anthropicConnector.extract(data)).toBeNull();
  });

  it('returns null for text_delta with empty text', () => {
    const data = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: '' },
    });
    expect(anthropicConnector.extract(data)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(anthropicConnector.extract('not json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(anthropicConnector.extract('')).toBeNull();
  });

  it('extracts thinking deltas as reasoning', () => {
    const data = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'considering' },
    });
    expect(anthropicConnector.extract(data)).toEqual({ reasoning: 'considering' });
  });

  it('extracts tool_use blocks and input_json_delta chunks', () => {
    const state = anthropicConnector.createState?.();
    const start = JSON.stringify({
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'search', input: {} },
    });
    const delta = JSON.stringify({
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'input_json_delta', partial_json: '{"q":"test"}' },
    });

    expect(state).toBeDefined();
    expect(anthropicConnector.extract(start, state)).toEqual({ toolDelta: { id: 'toolu_1', name: 'search', input: {} } });
    expect(anthropicConnector.extract(delta, state)).toEqual({ toolDelta: { id: 'toolu_1', input: '{"q":"test"}' } });
    expect(anthropicConnector.extract(JSON.stringify({ type: 'message_stop' }), state)).toEqual({ done: true });
  });

  it('returns an in-band error payload', () => {
    expect(anthropicConnector.extract(JSON.stringify({ type: 'error', error: { message: 'anthropic failed' } }))).toEqual({ error: 'anthropic failed' });
  });
});

// ---------------------------------------------------------------------------
// geminiConnector
// ---------------------------------------------------------------------------

describe('geminiConnector', () => {
  it('extracts text from candidates content parts', () => {
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({ text: 'Hello' });
  });

  it('concatenates text across multiple parts', () => {
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'foo' }, { text: 'bar' }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({ text: 'foobar' });
  });

  it('selects candidate index 0 instead of concatenating alternatives', () => {
    const data = JSON.stringify({
      candidates: [
        { index: 1, content: { parts: [{ text: 'alternative' }] } },
        { index: 0, content: { parts: [{ text: 'selected' }] } },
      ],
    });
    expect(geminiConnector.extract(data)).toEqual({ text: 'selected' });
  });

  it('extracts thought parts as reasoning', () => {
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'hidden chain', thought: true }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({ reasoning: 'hidden chain' });
  });

  it('extracts functionCall parts as tool deltas', () => {
    const data = JSON.stringify({
      candidates: [{ index: 0, content: { parts: [{ functionCall: { name: 'lookup', args: { q: 'test' } } }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({
      toolDelta: { id: 'gemini-0-function-0-lookup', name: 'lookup', input: { q: 'test' } },
    });
  });

  it('returns done for normal STOP with no text', () => {
    const data = JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({ done: true });
  });

  it('returns text and done for normal STOP alongside text', () => {
    const data = JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'end' }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({ text: 'end', done: true });
  });

  it('returns done for MAX_TOKENS while preserving emitted text', () => {
    const data = JSON.stringify({
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'truncated' }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({ text: 'truncated', done: true });
  });

  it('returns an error for blocked SAFETY with no text', () => {
    const data = JSON.stringify({
      candidates: [{ finishReason: 'SAFETY', content: { parts: [] }, safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT' }] }],
    });
    expect(geminiConnector.extract(data)).toEqual({
      error: 'Gemini response was blocked and returned no text (finishReason: SAFETY)',
    });
  });

  it('returns partial text and an error for blocked SAFETY with text', () => {
    const data = JSON.stringify({
      candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'partial' }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({
      text: 'partial',
      error: 'Gemini response ended with blocked finishReason: SAFETY',
    });
  });

  it('returns null when candidates array is empty', () => {
    const data = JSON.stringify({ candidates: [] });
    expect(geminiConnector.extract(data)).toBeNull();
  });

  it('returns null for JSON without candidates', () => {
    const data = JSON.stringify({ choices: [{ delta: { content: 'hi' } }] });
    expect(geminiConnector.extract(data)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(geminiConnector.extract('not json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(geminiConnector.extract('')).toBeNull();
  });

  it('returns null for candidate with empty parts text', () => {
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: '' }] } }],
    });
    expect(geminiConnector.extract(data)).toBeNull();
  });

  it('returns an in-band error payload', () => {
    expect(geminiConnector.extract(JSON.stringify({ error: { message: 'gemini failed' } }))).toEqual({ error: 'gemini failed' });
  });
});

// ---------------------------------------------------------------------------
// autoConnector
// ---------------------------------------------------------------------------

describe('autoConnector', () => {
  it('returns done for [DONE] sentinel', () => {
    expect(autoConnector.extract('[DONE]')).toEqual({ done: true });
  });

  it('delegates to openaiConnector for OpenAI-shaped JSON', () => {
    const data = JSON.stringify({ choices: [{ delta: { content: 'hi' } }] });
    expect(autoConnector.extract(data)).toEqual({ text: 'hi' });
  });

  it('returns an in-band error payload', () => {
    expect(autoConnector.extract(JSON.stringify({ error: 'stream failed' }))).toEqual({ error: 'stream failed' });
  });

  it('delegates to anthropicConnector for Anthropic-shaped JSON', () => {
    const data = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'hello' },
    });
    expect(autoConnector.extract(data)).toEqual({ text: 'hello' });
  });

  it('handles message_stop from Anthropic', () => {
    const data = JSON.stringify({ type: 'message_stop' });
    expect(autoConnector.extract(data)).toEqual({ done: true });
  });

  it('delegates to geminiConnector for Gemini-shaped JSON', () => {
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'hi' }] } }],
    });
    expect(autoConnector.extract(data)).toEqual({ text: 'hi' });
  });

  it('handles finishReason STOP from Gemini', () => {
    const data = JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [] } }],
    });
    expect(autoConnector.extract(data)).toEqual({ done: true });
  });

  it('falls back to plain text for non-JSON', () => {
    expect(autoConnector.extract('plain text chunk')).toEqual({ text: 'plain text chunk' });
  });

  it('returns null for empty string', () => {
    expect(autoConnector.extract('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getConnector
// ---------------------------------------------------------------------------

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

  it('returns a custom connector object as-is', () => {
    const custom: Connector = { name: 'custom', extract: vi.fn() };
    expect(getConnector(custom)).toBe(custom);
  });

  it('falls back to autoConnector for unknown string', () => {
    // @ts-expect-error intentional unknown string
    expect(getConnector('unknown-provider')).toBe(autoConnector);
  });
});
