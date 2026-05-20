import { describe, it, expect } from 'vitest';
import { anthropicConnector } from '../../connectors/anthropic';

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
    expect(anthropicConnector.extract(start, state)).toEqual({ toolDelta: { id: 'toolu_1', name: 'search', input: {}, provider: 'anthropic', providerId: 'toolu_1' } });
    expect(anthropicConnector.extract(delta, state)).toEqual({ toolDelta: { id: 'toolu_1', input: '{"q":"test"}', provider: 'anthropic', providerId: 'toolu_1' } });
    expect(anthropicConnector.extract(JSON.stringify({ type: 'message_stop' }), state)).toEqual({ done: true });
  });

  it('returns an in-band error payload', () => {
    const payload = { type: 'error', error: { message: 'anthropic failed' } };
    expect(anthropicConnector.extract(JSON.stringify(payload))).toEqual({ error: 'anthropic failed', errorPayload: payload });
  });

  it('does not treat a stray "error" string on a content_block_delta as terminal', () => {
    const data = JSON.stringify({
      type: 'content_block_delta',
      error: 'none',
      delta: { type: 'text_delta', text: 'hello' },
    });
    expect(anthropicConnector.extract(data)).toEqual({ text: 'hello' });
  });

  it('surfaces message_delta.stop_reason=end_turn as metadata only', () => {
    const data = JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 7 },
    });
    expect(anthropicConnector.extract(data)).toEqual({ metadata: { stopReason: 'end_turn' } });
  });

  it('surfaces message_delta.stop_reason=stop_sequence including the matched sequence', () => {
    const data = JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'stop_sequence', stop_sequence: '<<END>>' },
    });
    expect(anthropicConnector.extract(data)).toEqual({
      metadata: { stopReason: 'stop_sequence', stopSequence: '<<END>>' },
    });
  });

  it('surfaces message_delta.stop_reason=max_tokens as a non-fatal truncation warning', () => {
    const payload = {
      type: 'message_delta',
      delta: { stop_reason: 'max_tokens', stop_sequence: null },
    };
    const data = JSON.stringify(payload);
    const result = anthropicConnector.extract(data);
    expect(result).toEqual({
      metadata: { stopReason: 'max_tokens' },
      warning: {
        code: 'truncated',
        message: 'Anthropic response truncated by max_tokens',
        payload,
      },
    });
  });

  it('surfaces message_delta.stop_reason=refusal as a connector error', () => {
    const payload = {
      type: 'message_delta',
      delta: { stop_reason: 'refusal', stop_sequence: null },
    };
    const data = JSON.stringify(payload);
    expect(anthropicConnector.extract(data)).toEqual({
      error: 'Anthropic model refused to respond',
      errorPayload: payload,
      metadata: { stopReason: 'refusal' },
    });
  });

  it('returns null for message_delta without a stop_reason', () => {
    const data = JSON.stringify({ type: 'message_delta', delta: { stop_sequence: null }, usage: { output_tokens: 1 } });
    expect(anthropicConnector.extract(data)).toBeNull();
  });
});
