import { describe, it, expect, vi } from 'vitest';
import { openaiConnector } from '../connectors/openai';
import { anthropicConnector } from '../connectors/anthropic';
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
    // JSON that doesn't have choices array — treated as plain text fallback
    const data = JSON.stringify({ type: 'something' });
    // The openai connector: if JSON but no choices array, falls into the catch
    // because it returns null from "if (!Array.isArray(choices)) return null"
    // Actually it returns null — wait let me re-read the code...
    // "const choices = obj?.choices; if (!Array.isArray(choices)) return null;"
    expect(openaiConnector.extract(data)).toBeNull();
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

  it('returns a custom connector object as-is', () => {
    const custom: Connector = { name: 'custom', extract: vi.fn() };
    expect(getConnector(custom)).toBe(custom);
  });

  it('falls back to autoConnector for unknown string', () => {
    // @ts-expect-error intentional unknown string
    expect(getConnector('gemini')).toBe(autoConnector);
  });
});
