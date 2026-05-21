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

    it('omits the output channel when a tool-output-available frame has no output/result key', () => {
      // A malformed / partial result frame must not flip a still-executing tool
      // row to "finished with undefined output": the delta carries no `output`
      // property at all. Result-side analog of the `hasArgs` guard on the call path.
      const state = aiSdkConnector.createState?.();
      const frame = JSON.stringify({ type: 'tool-output-available', toolCallId: 'call_1' });
      const result = aiSdkConnector.extract(frame, state);
      expect(result).toStrictEqual({ toolDelta: { id: 'call_1', providerId: 'call_1' } });
      expect(Object.hasOwn((result as { toolDelta: object }).toolDelta, 'output')).toBe(false);
    });

    it('keeps an explicit falsy output (false) on a tool-output-available frame', () => {
      // `output: false` is a real result the tool returned — distinct from a
      // frame with no output key — so it must still set the output channel.
      const state = aiSdkConnector.createState?.();
      const frame = JSON.stringify({ type: 'tool-output-available', toolCallId: 'call_1', output: false });
      expect(aiSdkConnector.extract(frame, state))
        .toStrictEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', output: false } });
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

    it('omits the output channel when an a: result frame has no result/output key', () => {
      const state = aiSdkConnector.createState?.();
      const result = aiSdkConnector.extract('a:{"toolCallId":"call_1"}', state);
      expect(result).toStrictEqual({ toolDelta: { id: 'call_1', providerId: 'call_1' } });
      expect(Object.hasOwn((result as { toolDelta: object }).toolDelta, 'output')).toBe(false);
    });

    it('keeps an explicit falsy output (false) on an a: result frame', () => {
      const state = aiSdkConnector.createState?.();
      expect(aiSdkConnector.extract('a:{"toolCallId":"call_1","result":false}', state))
        .toStrictEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', output: false } });
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

    it('recognises the finish-step (e:) frame explicitly without leaking it as text', () => {
      // `e:` has its own `case` rather than falling through `default`; it is
      // dropped (returns null) without resetting state or signalling done.
      expect(aiSdkConnector.extract('e:{"finishReason":"tool-calls","usage":{}}')).toBeNull();
    });
  });

  describe('flush()', () => {
    it('resets per-send tool state on an abnormal close and emits no buffered tail', () => {
      const state = aiSdkConnector.createState?.();
      // A streaming start records the tool name so later frames can reuse it.
      aiSdkConnector.extract('b:{"toolCallId":"call_1","toolName":"weather"}', state);
      expect(aiSdkConnector.extract('a:{"toolCallId":"call_1","result":{"ok":true}}', state))
        .toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', name: 'weather', output: { ok: true } } });
      // The connector buffers nothing, so flush() returns null...
      expect(aiSdkConnector.flush?.(state)).toBeNull();
      // ...but it clears the remembered tool name, matching the [DONE]/d:/finish reset.
      expect(aiSdkConnector.extract('a:{"toolCallId":"call_1","result":{"ok":true}}', state))
        .toEqual({ toolDelta: { id: 'call_1', providerId: 'call_1', output: { ok: true } } });
    });

    it('tolerates being called with no state argument', () => {
      expect(aiSdkConnector.flush?.()).toBeNull();
    });
  });
});
