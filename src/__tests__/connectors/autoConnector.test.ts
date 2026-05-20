import { describe, it, expect } from 'vitest';
import { autoConnector } from '../../connectors/connectors';

describe('autoConnector', () => {
  it('returns done for [DONE] sentinel', () => {
    expect(autoConnector.extract('[DONE]')).toEqual({ done: true });
  });

  it('delegates to openaiConnector for OpenAI-shaped JSON', () => {
    const data = JSON.stringify({ choices: [{ delta: { content: 'hi' } }] });
    expect(autoConnector.extract(data)).toEqual({ text: 'hi' });
  });

  it('returns an in-band error payload', () => {
    const payload = { error: 'stream failed' };
    expect(autoConnector.extract(JSON.stringify(payload))).toEqual({ error: 'stream failed', errorPayload: payload });
  });

  it('does not treat a recognised event frame with an "error" field as a stream error', () => {
    const choices = JSON.stringify({ choices: [{ delta: { content: 'hi', error: 'ignore-me' } }] });
    expect(autoConnector.extract(choices)).toEqual({ text: 'hi' });
    const custom = JSON.stringify({ type: 'message', content: 'world', error: 'none' });
    expect(autoConnector.extract(custom)).toEqual({ text: 'world' });
  });

  it('delegates to anthropicConnector for Anthropic-shaped JSON', () => {
    const data = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'hello' },
    });
    expect(autoConnector.extract(data)).toEqual({ text: 'hello' });
  });

  it('falls back to generic text for unknown typed JSON events', () => {
    expect(autoConnector.extract(JSON.stringify({ type: 'delta', text: 'hello' }))).toEqual({ text: 'hello' });
    expect(autoConnector.extract(JSON.stringify({ type: 'message', content: 'world' }))).toEqual({ text: 'world' });
  });

  it('falls back to raw JSON text for unknown typed JSON without text fields', () => {
    const data = JSON.stringify({ type: 'custom', value: 1 });
    expect(autoConnector.extract(data)).toEqual({ text: data });
  });

  it('handles message_stop from Anthropic', () => {
    const data = JSON.stringify({ type: 'message_stop' });
    expect(autoConnector.extract(data)).toEqual({ done: true });
  });

  it('delegates to OpenAI Responses events before generic typed fallback', () => {
    const data = JSON.stringify({ type: 'response.output_text.delta', delta: 'hi' });
    expect(autoConnector.extract(data)).toEqual({ text: 'hi' });
  });

  it('delegates to aiSdkConnector for Vercel AI SDK UI message stream JSON', () => {
    const text = JSON.stringify({ type: 'text-delta', id: 't', delta: 'hi' });
    expect(autoConnector.extract(text)).toEqual({ text: 'hi' });
    const finish = JSON.stringify({ type: 'finish' });
    expect(autoConnector.extract(finish)).toEqual({ done: true });
    const errorPayload = { type: 'error', errorText: 'kaboom' };
    expect(autoConnector.extract(JSON.stringify(errorPayload))).toEqual({ error: 'kaboom', errorPayload });
  });

  it('delegates AI SDK tool-call-streaming-start / tool-call-delta / reasoning aliases to the AI SDK path', () => {
    const state = autoConnector.createState?.();
    const start = JSON.stringify({ type: 'tool-call-streaming-start', toolCallId: 'call_1', toolName: 'search' });
    const delta = JSON.stringify({ type: 'tool-call-delta', toolCallId: 'call_1', argsTextDelta: '{"q":' });
    const reasoning = JSON.stringify({ type: 'reasoning', text: 'thinking' });

    expect(autoConnector.extract(start, state)).toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', name: 'search' } });
    expect(autoConnector.extract(delta, state)).toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', name: 'search', input: '{"q":' } });
    expect(autoConnector.extract(reasoning, state)).toEqual({ reasoning: 'thinking' });
  });

  it('ignores AI SDK data-* wildcard frames and message-metadata instead of rendering them as raw JSON', () => {
    const dataFrame = JSON.stringify({ type: 'data-progress', id: 'p_1', data: { percent: 42 } });
    const metadataFrame = JSON.stringify({ type: 'message-metadata', messageMetadata: { foo: 'bar' } });

    expect(autoConnector.extract(dataFrame)).toBeNull();
    expect(autoConnector.extract(metadataFrame)).toBeNull();
  });

  it('delegates to aiSdkConnector for Vercel AI SDK data-stream protocol lines', () => {
    expect(autoConnector.extract('0:"hello"')).toEqual({ text: 'hello' });
    expect(autoConnector.extract('e:{"finishReason":"stop","usage":{}}')).toEqual({ done: true });
    expect(autoConnector.extract('3:"upstream failed"')).toEqual({ error: 'upstream failed', errorPayload: 'upstream failed' });
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

  it('routes plain-text <think>...</think> traces into reasoning instead of visible text', () => {
    const state = autoConnector.createState?.();
    expect(autoConnector.extract('<think>scratching head</think>', state)).toEqual({ reasoning: 'scratching head' });
    expect(autoConnector.extract('hello', state)).toEqual({ text: 'hello' });
  });

  it('preserves per-stream <think> state across fragmented plain-text chunks', () => {
    const state = autoConnector.createState?.();
    expect(autoConnector.extract('<think>scratch', state)).toEqual({ reasoning: 'scratch' });
    expect(autoConnector.extract('ing head</think>visible', state)).toEqual({ reasoning: 'ing head', text: 'visible' });
  });
});
