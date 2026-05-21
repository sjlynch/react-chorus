import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useChorusStream, type Transport } from '../../hooks/useChorusStream';
import { makeControlledSseResponse, makeSseResponse, resetUseChorusStreamTestEnv } from './fixtures';

// ---------------------------------------------------------------------------

describe('useChorusStream connector delivery', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(resetUseChorusStreamTestEnv);

  it('emits reasoning chunks and accumulated tool deltas from connectors', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'plan' } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":' } }] } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] } }] }),
      '[DONE]',
    ])));
    const onReasoning = vi.fn();
    const onToolDelta = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'openai' }));

    await act(async () => {
      await result.current.send('hello', [], { onChunk: vi.fn(), onReasoning, onToolDelta });
    });

    expect(onReasoning).toHaveBeenCalledWith('plan');
    expect(onToolDelta).toHaveBeenCalledTimes(2);
    expect(onToolDelta).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'call_1', name: 'search', input: '{"q":', provider: 'openai', providerId: 'call_1' }));
    expect(onToolDelta).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'call_1', name: 'search', input: { q: 'test' }, provider: 'openai', providerId: 'call_1' }));
  });

  it('routes non-fatal connector warnings to onWarning', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([
      JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'cut off' }] } }] }),
    ])));
    const onChunk = vi.fn();
    const onWarning = vi.fn();
    const onDone = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'gemini' }));

    await act(async () => {
      await result.current.send('hello', [], { onChunk, onWarning, onDone });
    });

    expect(onChunk).toHaveBeenCalledWith('cut off');
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ code: 'truncated' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('routes every warning to onWarning when one chunk carries multiple', async () => {
    // A Gemini chunk with an inlineData part that also hits MAX_TOKENS produces
    // both an `unsupported-part` and a `truncated` warning; both must reach the
    // consumer rather than the single `warning` slot dropping one.
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([
      JSON.stringify({ candidates: [{
        finishReason: 'MAX_TOKENS',
        content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] },
      }] }),
    ])));
    const onWarning = vi.fn();
    const onDone = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'gemini' }));

    await act(async () => {
      await result.current.send('hello', [], { onChunk: vi.fn(), onWarning, onDone });
    });

    expect(onWarning).toHaveBeenCalledTimes(2);
    expect(onWarning).toHaveBeenNthCalledWith(1, expect.objectContaining({ code: 'unsupported-part' }));
    expect(onWarning).toHaveBeenNthCalledWith(2, expect.objectContaining({ code: 'truncated' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('warns in dev rather than throwing when onWarning is omitted', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([
      JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'cut off' }] } }] }),
    ])));
    const onDone = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'gemini' }));

    await act(async () => {
      await result.current.send('hello', [], { onChunk: vi.fn(), onDone });
    });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('connector warning (truncated)'), expect.anything());
  });

  it('keeps the send successful when onWarning throws', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([
      JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'cut off' }] } }] }),
    ])));
    const onWarning = vi.fn(() => { throw new Error('warning observer boom'); });
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'gemini' }));

    await act(async () => {
      await expect(
        result.current.send('hello', [], { onChunk: vi.fn(), onWarning, onDone, onError }),
      ).resolves.toBeUndefined();
    });

    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('routes connector metadata to onMetadata', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }] }),
    ])));
    const onChunk = vi.fn();
    const onMetadata = vi.fn();
    const onDone = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'openai' }));

    await act(async () => {
      await result.current.send('hello', [], { onChunk, onMetadata, onDone });
    });

    expect(onChunk).toHaveBeenCalledWith('done');
    expect(onMetadata).toHaveBeenCalledTimes(1);
    expect(onMetadata).toHaveBeenCalledWith({ finishReason: 'stop' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('drops connector metadata silently when onMetadata is omitted', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }] }),
    ])));
    const onDone = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'openai' }));

    await act(async () => {
      await result.current.send('hello', [], { onChunk: vi.fn(), onDone });
    });

    expect(onDone).toHaveBeenCalledTimes(1);
    // Unlike a warning, metadata without an observer is not dev-logged — it is opt-in
    // diagnostics, so dropping it leaves no console noise.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('keeps the send successful when onMetadata throws', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }] }),
    ])));
    const onMetadata = vi.fn(() => { throw new Error('metadata observer boom'); });
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'openai' }));

    await act(async () => {
      await expect(
        result.current.send('hello', [], { onChunk: vi.fn(), onMetadata, onDone, onError }),
      ).resolves.toBeUndefined();
    });

    expect(onMetadata).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('forwards connectorOptions to the resolved built-in connector', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: '<reasoning>plan</reasoning>answer' } }] }),
      '[DONE]',
    ])));
    const onChunk = vi.fn();
    const onReasoning = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, {
      connector: 'openai',
      connectorOptions: { thinkTag: { start: '<reasoning>', end: '</reasoning>' } },
    }));

    await act(async () => {
      await result.current.send('hello', [], { onChunk, onReasoning });
    });

    expect(onReasoning).toHaveBeenCalledWith('plan');
    expect(onChunk).toHaveBeenCalledWith('answer');
  });

  it('leaves a custom tag in visible text when connectorOptions is omitted', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: '<reasoning>plan</reasoning>answer' } }] }),
      '[DONE]',
    ])));
    const onChunk = vi.fn();
    const onReasoning = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'openai' }));

    await act(async () => {
      await result.current.send('hello', [], { onChunk, onReasoning });
    });

    expect(onReasoning).not.toHaveBeenCalled();
    expect(onChunk).toHaveBeenCalledWith('<reasoning>plan</reasoning>answer');
  });

  it('emits every tool delta when one connector result contains multiple calls', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'tools:', tool_calls: [
        { index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"react"}' } },
        { index: 1, id: 'call_2', function: { name: 'lookup', arguments: '{"id":2}' } },
      ] } }] }),
      '[DONE]',
    ])));
    const onChunk = vi.fn();
    const onToolDelta = vi.fn();
    const onDone = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'openai' }));

    await act(async () => {
      await result.current.send('hello', [], { onChunk, onToolDelta, onDone });
    });

    expect(onChunk).toHaveBeenCalledWith('tools:');
    expect(onToolDelta).toHaveBeenCalledTimes(2);
    expect(onToolDelta).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'call_1', name: 'search', input: { q: 'react' } }));
    expect(onToolDelta).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'call_2', name: 'lookup', input: { id: 2 } }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('isolates OpenAI think-tag parser state between simultaneous streams', async () => {
    const streamA = makeControlledSseResponse();
    const streamB = makeControlledSseResponse();
    const onChunkA = vi.fn();
    const onChunkB = vi.fn();
    const onReasoningB = vi.fn();
    const hookA = renderHook(() => useChorusStream(vi.fn<Transport>(() => Promise.resolve(streamA.response)), { connector: 'openai' }));
    const hookB = renderHook(() => useChorusStream(vi.fn<Transport>(() => Promise.resolve(streamB.response)), { connector: 'openai' }));

    let sendA!: Promise<void>;
    let sendB!: Promise<void>;
    await act(async () => {
      sendA = hookA.result.current.send('a', [], { onChunk: onChunkA });
      sendB = hookB.result.current.send('b', [], { onChunk: onChunkB, onReasoning: onReasoningB });
      await Promise.resolve();
    });

    await act(async () => {
      streamA.emit('<think>');
      streamB.emit('plain from b');
    });

    await waitFor(() => expect(onChunkB).toHaveBeenCalledWith('plain from b'));
    expect(onReasoningB).not.toHaveBeenCalled();
    expect(onChunkA).not.toHaveBeenCalled();

    await act(async () => {
      streamA.emit('[DONE]');
      streamB.emit('[DONE]');
      await Promise.all([sendA, sendB]);
    });
  });

  it('isolates OpenAI tool-call id maps between simultaneous streams', async () => {
    const streamA = makeControlledSseResponse();
    const streamB = makeControlledSseResponse();
    const onToolDeltaA = vi.fn();
    const onToolDeltaB = vi.fn();
    const hookA = renderHook(() => useChorusStream(vi.fn<Transport>(() => Promise.resolve(streamA.response)), { connector: 'openai' }));
    const hookB = renderHook(() => useChorusStream(vi.fn<Transport>(() => Promise.resolve(streamB.response)), { connector: 'openai' }));

    let sendA!: Promise<void>;
    let sendB!: Promise<void>;
    await act(async () => {
      sendA = hookA.result.current.send('a', [], { onChunk: vi.fn(), onToolDelta: onToolDeltaA });
      sendB = hookB.result.current.send('b', [], { onChunk: vi.fn(), onToolDelta: onToolDeltaB });
      await Promise.resolve();
    });

    await act(async () => {
      streamA.emit(JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_A', function: { name: 'search', arguments: '{"a":' } }] } }] }));
      streamB.emit(JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_B', function: { name: 'search', arguments: '{"b":' } }] } }] }));
      streamA.emit(JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"one"}' } }] } }] }));
      streamB.emit(JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"two"}' } }] } }] }));
    });

    await waitFor(() => expect(onToolDeltaA).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'call_A', name: 'search', input: { a: 'one' }, provider: 'openai', providerId: 'call_A' })));
    expect(onToolDeltaB).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'call_B', name: 'search', input: { b: 'two' }, provider: 'openai', providerId: 'call_B' }));

    await act(async () => {
      streamA.emit('[DONE]');
      streamB.emit('[DONE]');
      await Promise.all([sendA, sendB]);
    });
  });

  it('isolates Anthropic tool block id maps between simultaneous streams', async () => {
    const streamA = makeControlledSseResponse();
    const streamB = makeControlledSseResponse();
    const onToolDeltaA = vi.fn();
    const onToolDeltaB = vi.fn();
    const hookA = renderHook(() => useChorusStream(vi.fn<Transport>(() => Promise.resolve(streamA.response)), { connector: 'anthropic' }));
    const hookB = renderHook(() => useChorusStream(vi.fn<Transport>(() => Promise.resolve(streamB.response)), { connector: 'anthropic' }));

    let sendA!: Promise<void>;
    let sendB!: Promise<void>;
    await act(async () => {
      sendA = hookA.result.current.send('a', [], { onChunk: vi.fn(), onToolDelta: onToolDeltaA });
      sendB = hookB.result.current.send('b', [], { onChunk: vi.fn(), onToolDelta: onToolDeltaB });
      await Promise.resolve();
    });

    await act(async () => {
      streamA.emit(JSON.stringify({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_A', name: 'search', input: {} } }));
      streamB.emit(JSON.stringify({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_B', name: 'search', input: {} } }));
      streamA.emit(JSON.stringify({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"a":"one"}' } }));
      streamB.emit(JSON.stringify({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"b":"two"}' } }));
    });

    await waitFor(() => expect(onToolDeltaA).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'toolu_A', name: 'search', input: { a: 'one' }, provider: 'anthropic', providerId: 'toolu_A' })));
    expect(onToolDeltaB).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'toolu_B', name: 'search', input: { b: 'two' }, provider: 'anthropic', providerId: 'toolu_B' }));

    await act(async () => {
      streamA.emit(JSON.stringify({ type: 'message_stop' }));
      streamB.emit(JSON.stringify({ type: 'message_stop' }));
      await Promise.all([sendA, sendB]);
    });
  });

  it('does not raise a connector error when the result has no error field', async () => {
    // Contrast with the empty-string case: a missing `error` key is genuinely
    // 'no error' and the stream must complete normally.
    const noErrorConnector = {
      name: 'no-error-test',
      extract: (data: string) => (data === '[DONE]' ? { done: true } : { text: data }),
    };
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse(['hi', '[DONE]'])));
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: noErrorConnector }));

    await act(async () => {
      await result.current.send('hello', [], { onChunk, onDone, onError });
    });

    expect(onChunk).toHaveBeenCalledWith('hi');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('flushes OpenAI think-tag buffers when the response body closes without [DONE]', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'I <' } }] }),
    ])));
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'openai' }));

    await act(async () => {
      await result.current.send('hello', [], { onChunk, onDone });
    });

    expect(onChunk).toHaveBeenNthCalledWith(1, 'I ');
    expect(onChunk).toHaveBeenNthCalledWith(2, '<');
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
