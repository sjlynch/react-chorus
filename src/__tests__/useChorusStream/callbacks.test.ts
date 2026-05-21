import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChorusStream, type Transport } from '../../hooks/useChorusStream';
import { deferred, makeSseResponse, resetUseChorusStreamTestEnv } from './fixtures';

// ---------------------------------------------------------------------------

describe('useChorusStream callbacks', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(resetUseChorusStreamTestEnv);

  it('sets sending true when send() starts and false when it completes', async () => {
    const response = deferred<Response>();
    const transport = vi.fn<Transport>(() => response.promise);
    const { result } = renderHook(() => useChorusStream(transport));

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = result.current.send('hello', [], { onChunk: vi.fn() });
    });

    expect(result.current.sending).toBe(true);

    await act(async () => {
      response.resolve(makeSseResponse(['done']));
      await sendPromise;
    });

    expect(result.current.sending).toBe(false);
  });

  it('calls onChunk for each SSE token', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse(['one', 'two', 'three'])));
    const onChunk = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await result.current.send('hello', [], { onChunk });
    });

    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(onChunk).toHaveBeenNthCalledWith(1, 'one');
    expect(onChunk).toHaveBeenNthCalledWith(2, 'two');
    expect(onChunk).toHaveBeenNthCalledWith(3, 'three');
  });

  it('delivers the first chunk to onChunk when onStart is provided', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse(['first', 'second'])));
    const onStart = vi.fn();
    const onChunk = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await result.current.send('hello', [], { onStart, onChunk });
    });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith('first');
    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenNthCalledWith(1, 'first');
    expect(onChunk).toHaveBeenNthCalledWith(2, 'second');
  });

  it('fires onStart once for a reasoning-then-tool turn that emits no answer text', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'thinking' } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"test"}' } }] } }] }),
      '[DONE]',
    ])));
    const onStart = vi.fn();
    const onChunk = vi.fn();
    const onReasoning = vi.fn();
    const onToolDelta = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'openai' }));

    await act(async () => {
      await result.current.send('hello', [], { onStart, onChunk, onReasoning, onToolDelta });
    });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith('');
    expect(onChunk).not.toHaveBeenCalled();
    expect(onReasoning).toHaveBeenCalledWith('thinking');
    expect(onToolDelta).toHaveBeenCalled();
  });

  it('calls onDone after all tokens', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse(['first', 'last'])));
    const calls: string[] = [];
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await result.current.send('hello', [], {
        onChunk: (chunk: string) => calls.push(`chunk:${chunk}`),
        onDone: () => calls.push('done'),
      });
    });

    expect(calls).toEqual(['chunk:first', 'chunk:last', 'done']);
  });

  it('rejects with onDone callback errors after a successful stream', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse(['done'])));
    const callbackError = new Error('done observer failed');
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await expect(result.current.send('hello', [], {
        onChunk: vi.fn(),
        onDone: () => { throw callbackError; },
        onError,
      })).rejects.toBe(callbackError);
    });

    expect(onError).not.toHaveBeenCalled();
    expect(result.current.sending).toBe(false);
  });
});
