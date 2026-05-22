import { describe, it, expect, vi } from 'vitest';
import { openaiConnector, createOpenAIConnector } from '../../connectors/openai';

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

  it('uses one reasoning delta source instead of concatenating multiple fields', () => {
    const data = JSON.stringify({
      choices: [{
        index: 0,
        delta: {
          reasoning: 'generic',
          reasoning_content: 'chat reasoning',
          reasoning_summary: 'summary',
          reasoning_summary_text: 'response summary',
        },
      }],
    });
    expect(openaiConnector.extract(data)).toEqual({ reasoning: 'chat reasoning' });
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
    expect(openaiConnector.extract(start, state)).toEqual({ toolDelta: { id: 'call_1', name: 'search', input: '{"q":', provider: 'openai', providerId: 'call_1' } });
    expect(openaiConnector.extract(next, state)).toEqual({ toolDelta: { id: 'call_1', input: '"test"}', provider: 'openai', providerId: 'call_1' } });
    expect(openaiConnector.extract('[DONE]', state)).toEqual({ done: true });
  });

  it('extracts parallel tool call deltas from one chunk', () => {
    const data = JSON.stringify({
      choices: [{
        index: 0,
        delta: { tool_calls: [
          { index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"react"}' } },
          { index: 1, id: 'call_2', function: { name: 'lookup', arguments: '{"id":1}' } },
        ] },
      }],
    });

    expect(openaiConnector.extract(data)).toEqual({
      toolDelta: { id: 'call_1', name: 'search', input: '{"q":"react"}', provider: 'openai', providerId: 'call_1' },
      toolDeltas: [
        { id: 'call_1', name: 'search', input: '{"q":"react"}', provider: 'openai', providerId: 'call_1' },
        { id: 'call_2', name: 'lookup', input: '{"id":1}', provider: 'openai', providerId: 'call_2' },
      ],
    });
  });

  it('falls back to array position when tool_call.index is missing so parallel calls do not collide', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const state = openaiConnector.createState?.();
      const data = JSON.stringify({
        model: 'together/glm-4',
        choices: [{
          index: 0,
          delta: { tool_calls: [
            { id: 'call_a', function: { name: 'search', arguments: '{"q":"react"}' } },
            { id: 'call_b', function: { name: 'lookup', arguments: '{"id":1}' } },
          ] },
        }],
      });

      const result = openaiConnector.extract(data, state);
      expect(result?.toolDeltas).toEqual([
        { id: 'call_a', name: 'search', input: '{"q":"react"}', provider: 'openai', providerId: 'call_a' },
        { id: 'call_b', name: 'lookup', input: '{"id":1}', provider: 'openai', providerId: 'call_b' },
      ]);
      expect(result?.toolDeltas?.[0]?.id).not.toBe(result?.toolDeltas?.[1]?.id);
      expect(warn).toHaveBeenCalled();
      const warned = warn.mock.calls.some(call => String(call[0]).includes('together/glm-4'));
      expect(warned).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('falls back to array position so generated tool ids are distinct when both id and index are missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const state = openaiConnector.createState?.();
      const data = JSON.stringify({
        choices: [{
          index: 0,
          delta: { tool_calls: [
            { function: { name: 'search', arguments: '{"q":"react"}' } },
            { function: { name: 'lookup', arguments: '{"id":1}' } },
          ] },
        }],
      });

      const result = openaiConnector.extract(data, state);
      const ids = result?.toolDeltas?.map(d => d.id) ?? [];
      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);
    } finally {
      warn.mockRestore();
    }
  });

  it('extracts mixed text and multiple tool deltas', () => {
    const data = JSON.stringify({
      choices: [{
        index: 0,
        delta: {
          content: 'checking',
          tool_calls: [
            { index: 0, id: 'call_1', function: { name: 'search', arguments: '{}' } },
            { index: 1, id: 'call_2', function: { name: 'lookup', arguments: '{}' } },
          ],
        },
      }],
    });

    const result = openaiConnector.extract(data);
    expect(result?.text).toBe('checking');
    expect(result?.toolDeltas).toHaveLength(2);
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
    const stringPayload = { error: 'upstream failed' };
    const objectPayload = { error: { message: 'bad request' } };
    expect(openaiConnector.extract(JSON.stringify(stringPayload))).toEqual({ error: 'upstream failed', errorPayload: stringPayload });
    expect(openaiConnector.extract(JSON.stringify(objectPayload))).toEqual({ error: 'bad request', errorPayload: objectPayload });
  });

  it('does not treat a delta field named "error" as a terminal stream error', () => {
    const data = JSON.stringify({ choices: [{ delta: { content: 'hi', error: 'ignore-me' } }] });
    expect(openaiConnector.extract(data)).toEqual({ text: 'hi' });
  });

  it('does not treat a top-level "error" string on a choices frame as terminal', () => {
    const data = JSON.stringify({ choices: [{ index: 0, delta: { content: 'hi' } }], error: 'none' });
    expect(openaiConnector.extract(data)).toEqual({ text: 'hi' });
  });

  it('splits mixed-case <Think> tags out of text content', () => {
    const data = JSON.stringify({ choices: [{ index: 0, delta: { content: '<Think>plan</Think>answer' } }] });
    expect(openaiConnector.extract(data)).toEqual({ reasoning: 'plan', text: 'answer' });
  });

  it('resolves the stream via finish_reason "length" with a truncated warning when [DONE] is absent', () => {
    const state = openaiConnector.createState?.();
    openaiConnector.extract(JSON.stringify({ choices: [{ index: 0, delta: { content: 'partial answer' } }] }), state);
    const final = openaiConnector.extract(JSON.stringify({ choices: [{ finish_reason: 'length', delta: {} }] }), state);
    expect(final?.done).toBe(true);
    expect(final?.warning?.code).toBe('truncated');
    expect(final?.metadata?.finishReason).toBe('length');
  });

  it('surfaces a content_filter finish_reason as a content_filter warning', () => {
    const result = openaiConnector.extract(JSON.stringify({ choices: [{ finish_reason: 'content_filter', delta: {} }] }));
    expect(result?.done).toBe(true);
    expect(result?.warning?.code).toBe('content_filter');
  });

  it('emits done without a warning for a normal stop finish_reason', () => {
    const result = openaiConnector.extract(JSON.stringify({ choices: [{ finish_reason: 'stop', delta: {} }] }));
    expect(result).toEqual({ done: true, metadata: { finishReason: 'stop' } });
  });

  it('emits final content and done together when one chunk carries both', () => {
    const result = openaiConnector.extract(JSON.stringify({ choices: [{ delta: { content: 'last words' }, finish_reason: 'stop' }] }));
    expect(result?.text).toBe('last words');
    expect(result?.done).toBe(true);
  });

  it('surfaces token usage from a trailing Chat Completions { choices: [], usage } chunk', () => {
    // OpenAI Chat Completions with `stream_options: { include_usage: true }`
    // emits a final chunk with an empty `choices` array and a top-level `usage`.
    const data = JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 11, completion_tokens: 6, total_tokens: 17 },
    });
    expect(openaiConnector.extract(data)).toEqual({
      metadata: { usage: { promptTokens: 11, completionTokens: 6, totalTokens: 17 } },
    });
  });

  it('returns null for an empty Chat Completions choices array with no usage', () => {
    expect(openaiConnector.extract(JSON.stringify({ choices: [] }))).toBeNull();
  });

  it('surfaces usage attached to the final content chunk alongside finish_reason', () => {
    // Some OpenAI-compatible proxies attach `usage` to the last content chunk
    // rather than a separate trailing chunk.
    const data = JSON.stringify({
      choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    });
    expect(openaiConnector.extract(data)).toEqual({
      text: 'done',
      done: true,
      metadata: { finishReason: 'stop', usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 } },
    });
  });

  it('buffers per-chunk usage and surfaces it once on the finish_reason chunk', () => {
    const state = openaiConnector.createState?.();
    // A proxy (OpenRouter, Azure) may attach a cumulative `usage` object to
    // every content chunk; emitting `metadata.usage` per chunk would make a
    // non-idempotent onMetadata consumer (running cost counter) over-count.
    const first = openaiConnector.extract(JSON.stringify({
      choices: [{ index: 0, delta: { content: 'hel' } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    }), state);
    expect(first).toEqual({ text: 'hel' });
    expect(first?.metadata).toBeUndefined();

    const second = openaiConnector.extract(JSON.stringify({
      choices: [{ index: 0, delta: { content: 'lo' } }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }), state);
    expect(second).toEqual({ text: 'lo' });
    expect(second?.metadata).toBeUndefined();

    // Only the terminating chunk surfaces usage — exactly once per turn.
    const final = openaiConnector.extract(JSON.stringify({
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
    }), state);
    expect(final).toEqual({
      done: true,
      metadata: { finishReason: 'stop', usage: { promptTokens: 3, completionTokens: 3, totalTokens: 6 } },
    });
  });

  it('surfaces the last buffered usage on a finish chunk that itself omits usage', () => {
    const state = openaiConnector.createState?.();
    openaiConnector.extract(JSON.stringify({
      choices: [{ index: 0, delta: { content: 'hi' } }],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    }), state);
    const final = openaiConnector.extract(JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }), state);
    expect(final?.metadata).toEqual({ finishReason: 'stop', usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 } });
  });

  it('does not re-emit usage on a trailing choices:[] chunk after the finish chunk surfaced it', () => {
    const state = openaiConnector.createState?.();
    const final = openaiConnector.extract(JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }), state);
    expect(final?.metadata?.usage).toEqual({ promptTokens: 5, completionTokens: 2, totalTokens: 7 });
    // A second terminal-shaped frame must not fire onMetadata again.
    const trailing = openaiConnector.extract(JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }), state);
    expect(trailing).toBeNull();
  });

  it('surfaces usage from the trailing choices:[] chunk when the finish chunk carried none', () => {
    // The standard OpenAI `include_usage` flow: a finish_reason chunk with no
    // usage, then a final `{ choices: [], usage }` chunk — one onMetadata call.
    const state = openaiConnector.createState?.();
    const final = openaiConnector.extract(JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }), state);
    expect(final).toEqual({ done: true, metadata: { finishReason: 'stop' } });
    const trailing = openaiConnector.extract(JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 },
    }), state);
    expect(trailing).toEqual({ metadata: { usage: { promptTokens: 9, completionTokens: 5, totalTokens: 14 } } });
  });

  it('surfaces buffered usage on [DONE] when no terminating chunk carried it', () => {
    const state = openaiConnector.createState?.();
    openaiConnector.extract(JSON.stringify({
      choices: [{ index: 0, delta: { content: 'hi' } }],
      usage: { prompt_tokens: 6, completion_tokens: 3, total_tokens: 9 },
    }), state);
    expect(openaiConnector.extract('[DONE]', state)).toEqual({
      done: true,
      metadata: { usage: { promptTokens: 6, completionTokens: 3, totalTokens: 9 } },
    });
  });

  it('flushes a buffered partial think tag when finish_reason ends the stream', () => {
    const state = openaiConnector.createState?.();
    expect(openaiConnector.extract(JSON.stringify({ choices: [{ index: 0, delta: { content: 'hi <' } }] }), state)).toEqual({ text: 'hi ' });
    const final = openaiConnector.extract(JSON.stringify({ choices: [{ finish_reason: 'stop', delta: {} }] }), state);
    expect(final).toEqual({ text: '<', done: true, metadata: { finishReason: 'stop' } });
  });

  it('compiles the think-tag regexes once per stream, not per streamed chunk', () => {
    const RealRegExp = RegExp;
    let constructed = 0;
    class CountingRegExp extends RealRegExp {
      constructor(...args: ConstructorParameters<typeof RegExp>) {
        constructed++;
        super(...args);
      }
    }
    vi.stubGlobal('RegExp', CountingRegExp);
    try {
      const connector = createOpenAIConnector();
      const state = connector.createState?.();
      const afterCreate = constructed;
      for (let i = 0; i < 25; i++) {
        connector.extract(JSON.stringify({ choices: [{ index: 0, delta: { content: `chunk ${i} ` } }] }), state);
      }
      expect(constructed).toBe(afterCreate);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('createOpenAIConnector', () => {
  it('accepts a custom reasoning tag pair', () => {
    const connector = createOpenAIConnector({ thinkTag: { start: '<reasoning>', end: '</reasoning>' } });
    const data = JSON.stringify({ choices: [{ index: 0, delta: { content: '<reasoning>plan</reasoning>answer' } }] });
    expect(connector.extract(data)).toEqual({ reasoning: 'plan', text: 'answer' });
  });

  it('leaves default <think> tags untouched when a custom pair is configured', () => {
    const connector = createOpenAIConnector({ thinkTag: { start: '<scratchpad>', end: '</scratchpad>' } });
    const data = JSON.stringify({ choices: [{ index: 0, delta: { content: '<think>plan</think>answer' } }] });
    expect(connector.extract(data)).toEqual({ text: '<think>plan</think>answer' });
  });

  it('opts out of case-insensitive matching when configured', () => {
    const connector = createOpenAIConnector({ thinkTag: { caseInsensitive: false } });
    const data = JSON.stringify({ choices: [{ index: 0, delta: { content: '<Think>plan</Think>answer' } }] });
    expect(connector.extract(data)).toEqual({ text: '<Think>plan</Think>answer' });
  });
});

describe('openaiConnector (Responses API)', () => {
  it('returns null for response.created (start telemetry, no payload)', () => {
    const data = JSON.stringify({ type: 'response.created', response: { id: 'resp_1' } });
    expect(openaiConnector.extract(data)).toBeNull();
  });

  it('returns null for response.output_item.started (lifecycle marker)', () => {
    const data = JSON.stringify({ type: 'response.output_item.started', output_index: 0 });
    expect(openaiConnector.extract(data)).toBeNull();
  });

  it('surfaces response.error as a connector error with the original payload', () => {
    const payload = { type: 'response.error', code: 'rate_limited', message: 'too many requests' };
    expect(openaiConnector.extract(JSON.stringify(payload))).toEqual({
      error: 'too many requests',
      errorPayload: payload,
    });
  });

  it('accumulates refusal deltas and emits a connector error on response.refusal.done', () => {
    const state = openaiConnector.createState?.();
    const added = JSON.stringify({ type: 'response.refusal.added', item_id: 'msg_1', output_index: 0 });
    const delta1 = JSON.stringify({ type: 'response.refusal.delta', item_id: 'msg_1', output_index: 0, delta: "I can't " });
    const delta2 = JSON.stringify({ type: 'response.refusal.delta', item_id: 'msg_1', output_index: 0, delta: 'help with that.' });
    const donePayload = { type: 'response.refusal.done', item_id: 'msg_1', output_index: 0 };

    expect(state).toBeDefined();
    expect(openaiConnector.extract(added, state)).toBeNull();
    expect(openaiConnector.extract(delta1, state)).toBeNull();
    expect(openaiConnector.extract(delta2, state)).toBeNull();
    expect(openaiConnector.extract(JSON.stringify(donePayload), state)).toEqual({
      error: "I can't help with that.",
      errorPayload: donePayload,
    });
  });

  it('prefers the explicit refusal text from response.refusal.done over accumulated deltas', () => {
    const state = openaiConnector.createState?.();
    openaiConnector.extract(JSON.stringify({ type: 'response.refusal.delta', item_id: 'msg_1', delta: 'partial' }), state);
    const donePayload = { type: 'response.refusal.done', item_id: 'msg_1', refusal: 'final refusal text' };
    expect(openaiConnector.extract(JSON.stringify(donePayload), state)).toEqual({
      error: 'final refusal text',
      errorPayload: donePayload,
    });
  });

  it('emits a generic refusal message when neither delta nor refusal field is present', () => {
    const donePayload = { type: 'response.refusal.done', item_id: 'msg_1' };
    expect(openaiConnector.extract(JSON.stringify(donePayload))).toEqual({
      error: 'OpenAI model refused to respond',
      errorPayload: donePayload,
    });
  });

  it('keeps refusals with distinct numeric output_index values in separate keys', () => {
    const state = openaiConnector.createState?.();
    openaiConnector.extract(JSON.stringify({ type: 'response.refusal.added', output_index: 0 }), state);
    openaiConnector.extract(JSON.stringify({ type: 'response.refusal.added', output_index: 1 }), state);
    openaiConnector.extract(JSON.stringify({ type: 'response.refusal.delta', output_index: 0, delta: 'first refusal' }), state);
    openaiConnector.extract(JSON.stringify({ type: 'response.refusal.delta', output_index: 1, delta: 'second refusal' }), state);
    const done0 = { type: 'response.refusal.done', output_index: 0 };
    const done1 = { type: 'response.refusal.done', output_index: 1 };
    expect(openaiConnector.extract(JSON.stringify(done0), state)).toEqual({ error: 'first refusal', errorPayload: done0 });
    expect(openaiConnector.extract(JSON.stringify(done1), state)).toEqual({ error: 'second refusal', errorPayload: done1 });
  });

  it('collapses function_call_arguments deltas that precede output_item.added into one tool block', () => {
    const state = openaiConnector.createState?.();
    const delta1 = JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"q":' });
    const delta2 = JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '"react"}' });
    // Deltas arrive before output_item.added — buffered, nothing emitted yet.
    expect(openaiConnector.extract(delta1, state)).toBeNull();
    expect(openaiConnector.extract(delta2, state)).toBeNull();

    const added = JSON.stringify({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search', arguments: '' },
    });
    const result = openaiConnector.extract(added, state);
    const deltas = result?.toolDeltas ?? (result?.toolDelta ? [result.toolDelta] : []);
    // The added block plus the two replayed deltas — every one keyed to call_1.
    expect(deltas.length).toBeGreaterThanOrEqual(3);
    expect(deltas.every(d => d.id === 'call_1')).toBe(true);
    expect(deltas.map(d => d.input).join('')).toBe('{"q":"react"}');

    // A later delta also resolves to the same id.
    const delta3 = JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: ' done' });
    expect(openaiConnector.extract(delta3, state)?.toolDelta?.id).toBe('call_1');
  });

  it('replays orphaned function_call_arguments deltas on response.completed when output_item.added never arrives', () => {
    const state = openaiConnector.createState?.();
    openaiConnector.extract(JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: 'fc_9', delta: '{"a":1}' }), state);
    const completed = openaiConnector.extract(JSON.stringify({ type: 'response.completed', response: {} }), state);
    expect(completed?.done).toBe(true);
    expect(completed?.toolDelta?.id).toBe('fc_9');
    expect(completed?.toolDelta?.input).toBe('{"a":1}');
  });

  it('surfaces incomplete_details and token usage from response.completed', () => {
    const payload = {
      type: 'response.completed',
      response: {
        incomplete_details: { reason: 'max_output_tokens' },
        usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
      },
    };
    const result = openaiConnector.extract(JSON.stringify(payload));
    expect(result?.done).toBe(true);
    expect(result?.warning?.code).toBe('truncated');
    expect(result?.metadata?.finishReason).toBe('max_output_tokens');
    expect(result?.metadata?.usage).toEqual({ promptTokens: 12, completionTokens: 7, totalTokens: 19 });
  });

  it('treats the terminal response.incomplete event like response.completed', () => {
    const result = openaiConnector.extract(JSON.stringify({
      type: 'response.incomplete',
      response: {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        usage: { input_tokens: 5, output_tokens: 9, total_tokens: 14 },
      },
    }));
    expect(result?.done).toBe(true);
    expect(result?.warning?.code).toBe('truncated');
    expect(result?.metadata?.finishReason).toBe('max_output_tokens');
    expect(result?.metadata?.usage).toEqual({ promptTokens: 5, completionTokens: 9, totalTokens: 14 });
  });

  it('drains buffered tool deltas on response.incomplete when output_item.added never arrives', () => {
    const state = openaiConnector.createState?.();
    openaiConnector.extract(JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: 'fc_3', delta: '{"x":1}' }), state);
    const incomplete = openaiConnector.extract(JSON.stringify({ type: 'response.incomplete', response: {} }), state);
    expect(incomplete?.done).toBe(true);
    expect(incomplete?.toolDelta?.id).toBe('fc_3');
    expect(incomplete?.toolDelta?.input).toBe('{"x":1}');
  });

  it('treats response.completed without incomplete_details as a clean done with usage', () => {
    const result = openaiConnector.extract(JSON.stringify({
      type: 'response.completed',
      response: { usage: { input_tokens: 3, output_tokens: 4 } },
    }));
    expect(result?.done).toBe(true);
    expect(result?.warning).toBeUndefined();
    expect(result?.metadata?.usage).toEqual({ promptTokens: 3, completionTokens: 4 });
  });

  it('does not double the arguments when output_item.done repeats the accumulated string', () => {
    const state = openaiConnector.createState?.();
    const fnItem = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search' };
    const events = [
      { type: 'response.output_item.added', output_index: 0, item: { ...fnItem, arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"q":' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '"x"}' },
      { type: 'response.output_item.done', output_index: 0, item: { ...fnItem, arguments: '{"q":"x"}' } },
    ];

    const inputs: string[] = [];
    let doneResult;
    for (const event of events) {
      const result = openaiConnector.extract(JSON.stringify(event), state);
      const deltas = result?.toolDeltas ?? (result?.toolDelta ? [result.toolDelta] : []);
      for (const d of deltas) {
        expect(d.id).toBe('call_1');
        if (typeof d.input === 'string') inputs.push(d.input);
      }
      if (event.type === 'response.output_item.done') doneResult = result;
    }

    // The arguments appear exactly once across the whole stream.
    expect(inputs.join('')).toBe('{"q":"x"}');
    // output_item.done still confirms the call id/name without re-emitting input.
    const doneDeltas = doneResult?.toolDeltas ?? (doneResult?.toolDelta ? [doneResult.toolDelta] : []);
    expect(doneDeltas).toEqual([{ id: 'call_1', provider: 'openai', providerId: 'call_1', name: 'search' }]);
  });

  it('reads the provider error message from response.failed', () => {
    const payload = { type: 'response.failed', response: { error: { message: 'model overloaded' } } };
    expect(openaiConnector.extract(JSON.stringify(payload))).toEqual({
      error: 'model overloaded',
      errorPayload: payload,
    });
  });

  it('falls back to a generic message when response.failed carries no error detail', () => {
    const payload = { type: 'response.failed', response: {} };
    expect(openaiConnector.extract(JSON.stringify(payload))).toEqual({
      error: 'OpenAI response failed',
      errorPayload: payload,
    });
  });

  it('drains a buffered refusal as an error on response.completed when refusal.done never arrives', () => {
    const state = openaiConnector.createState?.();
    openaiConnector.extract(JSON.stringify({ type: 'response.refusal.added', item_id: 'msg_1' }), state);
    openaiConnector.extract(JSON.stringify({ type: 'response.refusal.delta', item_id: 'msg_1', delta: 'I cannot help with that.' }), state);
    const completed = openaiConnector.extract(JSON.stringify({ type: 'response.completed', response: {} }), state);
    expect(completed?.done).toBe(true);
    expect(completed?.error).toBe('I cannot help with that.');
  });

  it('drains a buffered refusal as an error when the body closes without a done sentinel', () => {
    const state = openaiConnector.createState?.();
    openaiConnector.extract(JSON.stringify({ type: 'response.refusal.added', item_id: 'msg_1' }), state);
    openaiConnector.extract(JSON.stringify({ type: 'response.refusal.delta', item_id: 'msg_1', delta: 'refused' }), state);
    expect(openaiConnector.flush?.(state)).toEqual({ error: 'refused' });
  });

  it('drains a buffered refusal as an error on the [DONE] sentinel', () => {
    const state = openaiConnector.createState?.();
    openaiConnector.extract(JSON.stringify({ type: 'response.refusal.added', item_id: 'msg_1' }), state);
    openaiConnector.extract(JSON.stringify({ type: 'response.refusal.delta', item_id: 'msg_1', delta: 'refused' }), state);
    expect(openaiConnector.extract('[DONE]', state)).toEqual({ error: 'refused', done: true });
  });
});
