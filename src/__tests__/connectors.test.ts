import { describe, it, expect, vi } from 'vitest';
import { openaiConnector, createOpenAIConnector } from '../connectors/openai';
import { anthropicConnector } from '../connectors/anthropic';
import { geminiConnector } from '../connectors/gemini';
import { aiSdkConnector } from '../connectors/aiSdk';
import { autoConnector, getConnector } from '../connectors/connectors';
import { createThinkTagSplitter } from '../connectors/openai/thinkTagSplitter';
import type { Connector } from '../connectors/connectors';

// ---------------------------------------------------------------------------
// OpenAI think tag splitter
// ---------------------------------------------------------------------------

describe('createThinkTagSplitter', () => {
  it('splits a clean think tag pair', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('<think>plan</think>answer')).toEqual({ reasoning: 'plan', text: 'answer' });
  });

  it('handles partial tags spanning chunk boundaries', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('hello <thi')).toEqual({ text: 'hello ' });
    expect(splitter.feed('nk>plan</thi')).toEqual({ reasoning: 'plan' });
    expect(splitter.feed('nk>answer')).toEqual({ text: 'answer' });
  });

  it('flushes a buffered trailing partial tag as literal text at EOF', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('I <')).toEqual({ text: 'I ' });
    expect(splitter.flush()).toEqual({ text: '<' });
  });

  it('passes through no-tag text', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('plain text')).toEqual({ text: 'plain text' });
    expect(splitter.flush()).toEqual({});
  });

  it('matches the default tag pair case-insensitively', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('<Think>plan</Think>answer')).toEqual({ reasoning: 'plan', text: 'answer' });
  });

  it('matches mixed-case tags like <THINK>', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('hi <THINK>secret</THINK>bye')).toEqual({ reasoning: 'secret', text: 'hi bye' });
  });

  it('tolerates whitespace inside the angle brackets', () => {
    const splitter = createThinkTagSplitter();
    expect(splitter.feed('< think >plan</ think >answer')).toEqual({ reasoning: 'plan', text: 'answer' });
  });

  it('supports a custom reasoning tag pair', () => {
    const splitter = createThinkTagSplitter(undefined, { start: '<reasoning>', end: '</reasoning>' });
    expect(splitter.feed('<reasoning>plan</reasoning>answer')).toEqual({ reasoning: 'plan', text: 'answer' });
  });

  it('does not split default <think> tags when configured with a custom pair', () => {
    const splitter = createThinkTagSplitter(undefined, { start: '<scratchpad>', end: '</scratchpad>' });
    expect(splitter.feed('<think>still text</think>after')).toEqual({ text: '<think>still text</think>after' });
  });

  it('respects caseInsensitive: false', () => {
    const splitter = createThinkTagSplitter(undefined, { caseInsensitive: false });
    expect(splitter.feed('<Think>plan</Think>answer')).toEqual({ text: '<Think>plan</Think>answer' });
  });
});

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
    expect(anthropicConnector.extract(start, state)).toEqual({ toolDelta: { id: 'toolu_1', name: 'search', input: {}, provider: 'anthropic', providerId: 'toolu_1' } });
    expect(anthropicConnector.extract(delta, state)).toEqual({ toolDelta: { id: 'toolu_1', input: '{"q":"test"}', provider: 'anthropic', providerId: 'toolu_1' } });
    expect(anthropicConnector.extract(JSON.stringify({ type: 'message_stop' }), state)).toEqual({ done: true });
  });

  it('returns an in-band error payload', () => {
    const payload = { type: 'error', error: { message: 'anthropic failed' } };
    expect(anthropicConnector.extract(JSON.stringify(payload))).toEqual({ error: 'anthropic failed', errorPayload: payload });
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
      toolDelta: { id: 'gemini-0-function-0-lookup', name: 'lookup', input: { q: 'test' }, provider: 'gemini', generated: true },
    });
  });

  it('extracts multiple functionCall parts as tool deltas', () => {
    const data = JSON.stringify({
      candidates: [{ index: 0, content: { parts: [
        { text: 'using tools' },
        { functionCall: { name: 'lookup', args: { q: 'test' } } },
        { functionCall: { id: 'gemini-call-2', name: 'weather', args: { city: 'Paris' } } },
      ] } }],
    });

    expect(geminiConnector.extract(data)).toEqual({
      text: 'using tools',
      toolDelta: { id: 'gemini-0-function-1-lookup', name: 'lookup', input: { q: 'test' }, provider: 'gemini', generated: true },
      toolDeltas: [
        { id: 'gemini-0-function-1-lookup', name: 'lookup', input: { q: 'test' }, provider: 'gemini', generated: true },
        { id: 'gemini-call-2', name: 'weather', input: { city: 'Paris' }, provider: 'gemini', providerId: 'gemini-call-2' },
      ],
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

  it.each(['FINISH_REASON_UNSPECIFIED', 'UNSPECIFIED'])('returns an error for Gemini %s finish reason', finishReason => {
    const payload = {
      candidates: [{ finishReason, content: { parts: [{ text: 'Hello' }] } }],
    };
    expect(geminiConnector.extract(JSON.stringify(payload))).toEqual({
      text: 'Hello',
      error: 'Gemini response ended with an unspecified finish reason',
      errorPayload: payload,
    });
  });

  it('returns an error for blocked SAFETY with no text', () => {
    const payload = {
      candidates: [{ finishReason: 'SAFETY', content: { parts: [] }, safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT' }] }],
    };
    expect(geminiConnector.extract(JSON.stringify(payload))).toEqual({
      error: 'Gemini response was blocked and returned no text (finishReason: SAFETY)',
      errorPayload: payload,
    });
  });

  it('returns partial text and an error for blocked SAFETY with text', () => {
    const payload = {
      candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'partial' }] } }],
    };
    expect(geminiConnector.extract(JSON.stringify(payload))).toEqual({
      text: 'partial',
      error: 'Gemini response ended with blocked finishReason: SAFETY',
      errorPayload: payload,
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
    const payload = { error: { message: 'gemini failed' } };
    expect(geminiConnector.extract(JSON.stringify(payload))).toEqual({ error: 'gemini failed', errorPayload: payload });
  });
});

// ---------------------------------------------------------------------------
// aiSdkConnector
// ---------------------------------------------------------------------------

describe('aiSdkConnector', () => {
  describe('UI message stream (toUIMessageStreamResponse)', () => {
    it('extracts text from text-delta frames', () => {
      const data = JSON.stringify({ type: 'text-delta', id: 'msg_1', delta: 'Hello' });
      expect(aiSdkConnector.extract(data)).toEqual({ text: 'Hello' });
    });

    it('extracts reasoning from reasoning-delta frames', () => {
      const data = JSON.stringify({ type: 'reasoning-delta', id: 'r_1', delta: 'considering' });
      expect(aiSdkConnector.extract(data)).toEqual({ reasoning: 'considering' });
    });

    it('ignores lifecycle frames that have no visible payload', () => {
      expect(aiSdkConnector.extract(JSON.stringify({ type: 'start', messageId: 'm_1' }))).toBeNull();
      expect(aiSdkConnector.extract(JSON.stringify({ type: 'start-step' }))).toBeNull();
      expect(aiSdkConnector.extract(JSON.stringify({ type: 'text-start', id: 't_1' }))).toBeNull();
      expect(aiSdkConnector.extract(JSON.stringify({ type: 'text-end', id: 't_1' }))).toBeNull();
      expect(aiSdkConnector.extract(JSON.stringify({ type: 'finish-step' }))).toBeNull();
    });

    it('extracts tool calls and remembers the tool name across delta frames', () => {
      const state = aiSdkConnector.createState?.();
      const start = JSON.stringify({ type: 'tool-input-start', toolCallId: 'call_1', toolName: 'search' });
      const delta = JSON.stringify({ type: 'tool-input-delta', toolCallId: 'call_1', inputTextDelta: '{"q":"react"}' });
      const ready = JSON.stringify({ type: 'tool-input-available', toolCallId: 'call_1', toolName: 'search', input: { q: 'react' } });
      const result = JSON.stringify({ type: 'tool-output-available', toolCallId: 'call_1', output: { ok: true } });

      expect(state).toBeDefined();
      expect(aiSdkConnector.extract(start, state)).toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', name: 'search' } });
      expect(aiSdkConnector.extract(delta, state)).toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', name: 'search', input: '{"q":"react"}' } });
      expect(aiSdkConnector.extract(ready, state)).toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', name: 'search', input: { q: 'react' } } });
      expect(aiSdkConnector.extract(result, state)).toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', name: 'search', output: { ok: true } } });
    });

    it('returns done on finish frames', () => {
      expect(aiSdkConnector.extract(JSON.stringify({ type: 'finish' }))).toEqual({ done: true });
      expect(aiSdkConnector.extract(JSON.stringify({ type: 'finish-message' }))).toEqual({ done: true });
    });

    it('surfaces in-band errors with the original payload', () => {
      const payload = { type: 'error', errorText: 'upstream timed out' };
      expect(aiSdkConnector.extract(JSON.stringify(payload))).toEqual({ error: 'upstream timed out', errorPayload: payload });
    });

    it('falls back to error string on shaped error payloads without errorText', () => {
      const payload = { error: { message: 'bad request' } };
      expect(aiSdkConnector.extract(JSON.stringify(payload))).toEqual({ error: 'bad request', errorPayload: payload });
    });

    it('returns done for the [DONE] sentinel even when no finish frame arrived', () => {
      expect(aiSdkConnector.extract('[DONE]')).toEqual({ done: true });
    });
  });

  describe('data stream protocol (toDataStreamResponse)', () => {
    it('extracts text from 0: frames', () => {
      expect(aiSdkConnector.extract('0:"Hello"')).toEqual({ text: 'Hello' });
    });

    it('extracts reasoning from g: frames', () => {
      expect(aiSdkConnector.extract('g:"considering"')).toEqual({ reasoning: 'considering' });
    });

    it('extracts tool call deltas across 9/c/a frames', () => {
      const state = aiSdkConnector.createState?.();
      const start = '9:{"toolCallId":"call_1","toolName":"search","args":{"q":"react"}}';
      const fragment = 'c:{"toolCallId":"call_1","argsTextDelta":" extra"}';
      const result = 'a:{"toolCallId":"call_1","result":{"ok":true}}';

      expect(state).toBeDefined();
      expect(aiSdkConnector.extract(start, state)).toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', name: 'search', input: { q: 'react' } } });
      expect(aiSdkConnector.extract(fragment, state)).toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', name: 'search', input: ' extra' } });
      expect(aiSdkConnector.extract(result, state)).toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', name: 'search', output: { ok: true } } });
    });

    it('extracts a streaming tool-call start from b: frames', () => {
      expect(aiSdkConnector.extract('b:{"toolCallId":"call_2","toolName":"weather"}')).toEqual({
        toolDelta: { id: 'call_2', providerId: 'call_2', name: 'weather' },
      });
    });

    it('returns done on finish-step (d:) and finish-message (e:) frames', () => {
      expect(aiSdkConnector.extract('d:{"finishReason":"stop","usage":{}}')).toEqual({ done: true });
      expect(aiSdkConnector.extract('e:{"finishReason":"stop","usage":{}}')).toEqual({ done: true });
    });

    it('surfaces 3: error frames with the original payload', () => {
      expect(aiSdkConnector.extract('3:"upstream failed"')).toEqual({ error: 'upstream failed', errorPayload: 'upstream failed' });
    });

    it('ignores unknown / annotation-only frames so protocol text never leaks', () => {
      expect(aiSdkConnector.extract('f:{"messageId":"m_1"}')).toBeNull();
      expect(aiSdkConnector.extract('2:[{"role":"assistant"}]')).toBeNull();
      expect(aiSdkConnector.extract('8:[{"id":"a"}]')).toBeNull();
      expect(aiSdkConnector.extract('h:"sig"')).toBeNull();
      expect(aiSdkConnector.extract('i:"redacted"')).toBeNull();
      expect(aiSdkConnector.extract('j:"https://example.com"')).toBeNull();
    });

    it('returns null for malformed prefix lines and never leaks them as text', () => {
      expect(aiSdkConnector.extract('0:not-json')).toBeNull();
      expect(aiSdkConnector.extract('plain text without prefix')).toBeNull();
      expect(aiSdkConnector.extract('')).toBeNull();
    });
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

  it('returns aiSdkConnector for "ai-sdk"', () => {
    const c = getConnector('ai-sdk');
    expect(c.name).toBe('ai-sdk');
  });

  it('returns a custom connector object as-is', () => {
    const custom: Connector = { name: 'custom', extract: vi.fn() };
    expect(getConnector(custom)).toBe(custom);
  });

  it('falls back to autoConnector for unknown string', () => {
    // @ts-expect-error intentional unknown string
    expect(getConnector('unknown-provider')).toBe(autoConnector);
  });

  it('returns a configured openai connector when called with options', () => {
    const connector = getConnector('openai', { thinkTag: { start: '<reasoning>', end: '</reasoning>' } });
    expect(connector).not.toBe(openaiConnector);
    expect(connector.name).toBe('openai');
    const data = JSON.stringify({ choices: [{ index: 0, delta: { content: '<reasoning>plan</reasoning>answer' } }] });
    expect(connector.extract(data)).toEqual({ reasoning: 'plan', text: 'answer' });
  });

  it('returns the default openaiConnector when no options are provided', () => {
    expect(getConnector('openai')).toBe(openaiConnector);
  });
});
