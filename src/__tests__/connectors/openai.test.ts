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
});
