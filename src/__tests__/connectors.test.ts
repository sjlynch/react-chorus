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

  it('concatenates text across multiple choices', () => {
    const data = JSON.stringify({
      choices: [{ delta: { content: 'foo' } }, { delta: { content: 'bar' } }],
    });
    expect(openaiConnector.extract(data)).toEqual({ text: 'foobar' });
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

  it('returns null for input_json_delta (tool use)', () => {
    const data = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"q":' },
    });
    expect(anthropicConnector.extract(data)).toBeNull();
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

  it('concatenates text across multiple candidates', () => {
    const data = JSON.stringify({
      candidates: [
        { content: { parts: [{ text: 'a' }] } },
        { content: { parts: [{ text: 'b' }] } },
      ],
    });
    expect(geminiConnector.extract(data)).toEqual({ text: 'ab' });
  });

  it('returns done when finishReason is set with no text', () => {
    const data = JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({ done: true });
  });

  it('returns text and done when finishReason is set alongside text', () => {
    const data = JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'end' }] } }],
    });
    expect(geminiConnector.extract(data)).toEqual({ text: 'end', done: true });
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
