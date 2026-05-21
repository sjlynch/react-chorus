import { describe, it, expect, vi } from 'vitest';
import { aiSdkConnector } from '../../connectors/aiSdk';

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

    it('drops empty-string tool-argument deltas instead of emitting an input-resetting toolDelta', () => {
      const state = aiSdkConnector.createState?.();
      const empty = JSON.stringify({ type: 'tool-input-delta', toolCallId: 'call_1', inputTextDelta: '' });
      const emptyAlias = JSON.stringify({ type: 'tool-call-delta', toolCallId: 'call_1', argsTextDelta: '' });
      expect(aiSdkConnector.extract(empty, state)).toBeNull();
      expect(aiSdkConnector.extract(emptyAlias, state)).toBeNull();
    });

    it('keeps the populated alias when a mixed-alias tool-input-delta carries an empty argsTextDelta', () => {
      const state = aiSdkConnector.createState?.();
      const frame = JSON.stringify({ type: 'tool-input-delta', toolCallId: 'call_1', argsTextDelta: '', inputTextDelta: 'hello world' });
      expect(aiSdkConnector.extract(frame, state)).toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', input: 'hello world' } });
    });

    it('keeps the populated alias when a mixed-alias tool-call-delta carries an empty inputTextDelta', () => {
      const state = aiSdkConnector.createState?.();
      const frame = JSON.stringify({ type: 'tool-call-delta', toolCallId: 'call_1', inputTextDelta: '', argsTextDelta: 'hello world' });
      expect(aiSdkConnector.extract(frame, state)).toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', input: 'hello world' } });
    });

    it('warns once in dev when a tool frame is missing toolCallId and stays silent on the second identical frame', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const state = aiSdkConnector.createState?.();
        const frame = JSON.stringify({ type: 'tool-input-delta', inputTextDelta: 'foo' });

        expect(aiSdkConnector.extract(frame, state)).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/tool-input-delta/));
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/toolCallId/));

        expect(aiSdkConnector.extract(frame, state)).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
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

    it('returns done on the finish-message (d:) frame', () => {
      expect(aiSdkConnector.extract('d:{"finishReason":"stop","usage":{}}')).toEqual({ done: true });
    });

    it('does not terminate the stream on a finish-step (e:) frame mid multi-step run', () => {
      const state = aiSdkConnector.createState?.();
      // `e:` ends one step (e.g. between a tool call and the model's follow-up
      // turn); a `streamText` agent with `maxSteps > 1` must keep streaming.
      expect(aiSdkConnector.extract('e:{"finishReason":"tool-calls","usage":{}}', state)).toBeNull();
      // Text from the model's follow-up step still streams after the e: frame.
      expect(aiSdkConnector.extract('0:"follow-up"', state)).toEqual({ text: 'follow-up' });
    });

    it('surfaces 3: error frames with the original frame line as errorPayload', () => {
      expect(aiSdkConnector.extract('3:"upstream failed"'))
        .toEqual({ error: 'upstream failed', errorPayload: '3:"upstream failed"' });
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

    it('drops empty argsTextDelta on c: frames', () => {
      const state = aiSdkConnector.createState?.();
      expect(aiSdkConnector.extract('c:{"toolCallId":"call_1","argsTextDelta":""}', state)).toBeNull();
    });

    it('keeps the populated alias on a mixed-alias c: frame with an empty argsTextDelta', () => {
      const state = aiSdkConnector.createState?.();
      expect(aiSdkConnector.extract('c:{"toolCallId":"call_1","argsTextDelta":"","inputTextDelta":"hello world"}', state))
        .toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', input: 'hello world' } });
    });

    it('keeps the populated alias on a mixed-alias c: frame with an empty inputTextDelta', () => {
      const state = aiSdkConnector.createState?.();
      expect(aiSdkConnector.extract('c:{"toolCallId":"call_1","inputTextDelta":"","argsTextDelta":"hello world"}', state))
        .toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', input: 'hello world' } });
    });
  });
});
