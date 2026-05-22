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

  it('returns null for message_start without usage', () => {
    const data = JSON.stringify({ type: 'message_start', message: { id: 'msg_1', role: 'assistant' } });
    expect(anthropicConnector.extract(data)).toBeNull();
  });

  it('surfaces message_start usage.input_tokens as metadata', () => {
    const data = JSON.stringify({
      type: 'message_start',
      message: { id: 'msg_1', role: 'assistant', usage: { input_tokens: 42, output_tokens: 1 } },
    });
    expect(anthropicConnector.extract(data)).toEqual({
      metadata: { usage: { promptTokens: 42, completionTokens: 1 } },
    });
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

  it('surfaces signature_delta as thinkingSignature metadata', () => {
    const data = JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'Er8BCkY...sig' },
    });
    expect(anthropicConnector.extract(data)).toEqual({
      metadata: { thinkingSignature: 'Er8BCkY...sig' },
    });
  });

  it('returns null for signature_delta with an empty or missing signature', () => {
    const empty = JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: '' },
    });
    const missing = JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta' },
    });
    expect(anthropicConnector.extract(empty)).toBeNull();
    expect(anthropicConnector.extract(missing)).toBeNull();
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

  it('surfaces message_delta.stop_reason=end_turn with token usage as metadata', () => {
    const data = JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 7 },
    });
    expect(anthropicConnector.extract(data)).toEqual({
      metadata: { stopReason: 'end_turn', usage: { completionTokens: 7 } },
    });
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

  it('surfaces message_delta usage even when no stop_reason is present', () => {
    const data = JSON.stringify({ type: 'message_delta', delta: { stop_sequence: null }, usage: { output_tokens: 1 } });
    expect(anthropicConnector.extract(data)).toEqual({ metadata: { usage: { completionTokens: 1 } } });
  });

  it('returns null for message_delta with neither a stop_reason nor usage', () => {
    const data = JSON.stringify({ type: 'message_delta', delta: { stop_sequence: null } });
    expect(anthropicConnector.extract(data)).toBeNull();
  });

  it('flush() resets per-send tool-id maps on an abnormal close and emits no buffered tail', () => {
    const state = anthropicConnector.createState?.();
    const start = JSON.stringify({
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'search', input: {} },
    });
    anthropicConnector.extract(start, state);
    // The connector buffers no partial output, so flush() returns null...
    expect(anthropicConnector.flush?.(state)).toBeNull();
    // ...but it clears the block-index → tool-id map, so a later input_json_delta
    // for the same block falls back to a generated id instead of `toolu_1`.
    const delta = JSON.stringify({
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'input_json_delta', partial_json: '{"q":"x"}' },
    });
    expect(anthropicConnector.extract(delta, state)).toEqual({
      toolDelta: { id: 'anthropic-tool-2', input: '{"q":"x"}', provider: 'anthropic', generated: true },
    });
  });

  it('flush() tolerates being called with no state argument', () => {
    expect(anthropicConnector.flush?.()).toBeNull();
  });

  it('extracts citations_delta as a message source', () => {
    const data = JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'citations_delta',
        citation: {
          type: 'web_search_result_location',
          cited_text: 'react-chorus is great',
          url: 'https://example.com/post',
          title: 'Example Post',
          encrypted_index: 'enc-1',
        },
      },
    });
    expect(anthropicConnector.extract(data)).toEqual({
      source: {
        id: 'https://example.com/post',
        type: 'url',
        title: 'Example Post',
        url: 'https://example.com/post',
        snippet: 'react-chorus is great',
        metadata: {
          provider: 'anthropic',
          citationType: 'web_search_result_location',
          encryptedIndex: 'enc-1',
        },
      },
    });
  });

  it('extracts a document char_location citations_delta with document metadata', () => {
    const data = JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'citations_delta',
        citation: {
          type: 'char_location',
          cited_text: 'page text',
          document_index: 0,
          document_title: 'manual.pdf',
          start_char_index: 10,
          end_char_index: 19,
        },
      },
    });
    expect(anthropicConnector.extract(data)).toEqual({
      source: {
        id: 'manual.pdf#0',
        type: 'document',
        title: 'manual.pdf',
        snippet: 'page text',
        metadata: {
          provider: 'anthropic',
          citationType: 'char_location',
          documentIndex: 0,
          documentTitle: 'manual.pdf',
          startCharIndex: 10,
          endCharIndex: 19,
        },
      },
    });
  });

  it('extracts a web_search_tool_result content block as a list of sources', () => {
    const data = JSON.stringify({
      type: 'content_block_start',
      index: 1,
      content_block: {
        type: 'web_search_tool_result',
        tool_use_id: 'srvtoolu_1',
        content: [
          { type: 'web_search_result', url: 'https://a.example/one', title: 'One', encrypted_content: 'enc-a', page_age: '1 day' },
          { type: 'web_search_result', url: 'https://b.example/two', title: 'Two' },
        ],
      },
    });
    expect(anthropicConnector.extract(data)).toEqual({
      sources: [
        {
          id: 'https://a.example/one',
          type: 'url',
          title: 'One',
          url: 'https://a.example/one',
          metadata: {
            provider: 'anthropic',
            resultType: 'web_search_result',
            toolUseId: 'srvtoolu_1',
            pageAge: '1 day',
            encryptedContent: 'enc-a',
          },
        },
        {
          id: 'https://b.example/two',
          type: 'url',
          title: 'Two',
          url: 'https://b.example/two',
          metadata: {
            provider: 'anthropic',
            resultType: 'web_search_result',
            toolUseId: 'srvtoolu_1',
          },
        },
      ],
    });
  });

  it('returns null for a web_search_tool_result with no renderable entries', () => {
    const data = JSON.stringify({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_2', content: [] },
    });
    expect(anthropicConnector.extract(data)).toBeNull();
  });

  it('returns null for a citations_delta with no renderable fields', () => {
    const data = JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'citations_delta', citation: { type: 'char_location' } },
    });
    expect(anthropicConnector.extract(data)).toBeNull();
  });
});
