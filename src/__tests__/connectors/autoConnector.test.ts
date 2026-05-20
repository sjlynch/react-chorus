import { describe, it, expect } from 'vitest';
import { autoConnector, aiSdkConnector } from '../../connectors/connectors';

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

  it('renders plain-text lines starting with [a-z0-9]: as visible text instead of routing them to the data-stream parser', () => {
    expect(autoConnector.extract('a: see the list below')).toEqual({ text: 'a: see the list below' });
    expect(autoConnector.extract('e: for example')).toEqual({ text: 'e: for example' });
    expect(autoConnector.extract('c: minor')).toEqual({ text: 'c: minor' });
  });

  it('does not let plain-text d:/e: lines terminate an auto stream', () => {
    expect(autoConnector.extract('d:0')).toEqual({ text: 'd:0' });
    expect(autoConnector.extract('e:"note"')).toEqual({ text: 'e:"note"' });
  });

  it('still routes genuine data-stream frames after tightening the auto dispatch', () => {
    expect(autoConnector.extract('0:"hello"')).toEqual({ text: 'hello' });
    expect(autoConnector.extract('e:{"finishReason":"stop","usage":{}}')).toEqual({ done: true });
  });

  it('parses an AI SDK frame carrying a stray top-level error key as its frame type, matching aiSdkConnector', () => {
    const textFrame = JSON.stringify({ type: 'text-delta', id: 't', delta: 'hi', error: 'stray' });
    expect(autoConnector.extract(textFrame)).toEqual({ text: 'hi' });
    expect(autoConnector.extract(textFrame)).toEqual(aiSdkConnector.extract(textFrame));

    const finishFrame = JSON.stringify({ type: 'finish', error: 'stray' });
    expect(autoConnector.extract(finishFrame)).toEqual({ done: true });
    expect(autoConnector.extract(finishFrame)).toEqual(aiSdkConnector.extract(finishFrame));
  });

  it('routes flush() to the sub-connector that first consumed the stream, not always OpenAI', () => {
    // Stream auto-detected as AI SDK on its first frame.
    const aiSdkState = autoConnector.createState?.();
    expect(autoConnector.extract(JSON.stringify({ type: 'text-delta', delta: 'hi' }), aiSdkState)).toEqual({ text: 'hi' });
    // A later plain-text fragment buffers a partial `<think` tag inside the
    // OpenAI sub-connector, but the stream was consumed by AI SDK — flush() must
    // route to the AI SDK connector (no flush) rather than draining the buffer.
    autoConnector.extract('<th', aiSdkState);
    expect(autoConnector.flush?.(aiSdkState)).toBeNull();

    // A plain-text stream is still flushed through the OpenAI sub-connector.
    const plainState = autoConnector.createState?.();
    autoConnector.extract('answer <th', plainState);
    expect(autoConnector.flush?.(plainState)).toEqual({ text: '<th' });
  });
});
