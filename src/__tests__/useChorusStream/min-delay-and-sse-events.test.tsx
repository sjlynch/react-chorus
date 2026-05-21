import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChorusStream, type Transport } from '../../hooks/useChorusStream';
import { ChorusStreamError } from '../../streaming/errors';
import { makeResponse, makeSseResponse, resetUseChorusStreamTestEnv } from './fixtures';

// ---------------------------------------------------------------------------

describe('useChorusStream minDelay and named SSE events', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(resetUseChorusStreamTestEnv);

  it('calls onDone immediately after the last chunk when minDelayMs is 0', async () => {
    const transport = vi.fn<Transport>(async () => makeResponse());
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await result.current.send('hello', [], { onChunk, onDone, minDelayMs: 0 });
    });

    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('delays the first chunk until minDelayMs has elapsed when the transport resolves faster', async () => {
    vi.useFakeTimers();
    try {
      let resolveTransport!: (response: Response) => void;
      const transport = vi.fn<Transport>(() => new Promise<Response>(resolve => {
        resolveTransport = resolve;
      }));
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const { result } = renderHook(() => useChorusStream(transport));

      let sendPromise!: Promise<void>;
      act(() => {
        sendPromise = result.current.send('hello', [], { onChunk, onDone, minDelayMs: 500 });
      });

      // Transport resolves quickly (10ms elapsed), then SSE stream is read.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
        resolveTransport(makeResponse());
        // Flush microtasks so readSSEStream completes and schedules the first-token timer.
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(onChunk).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();

      // Partway through the remaining ~490ms wait — chunks and done are still pending.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(onChunk).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();

      // Finish the delay; the buffered chunk flushes before onDone.
      await act(async () => {
        await vi.runAllTimersAsync();
        await sendPromise;
      });
      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces a named event: error frame as a ChorusStreamError', async () => {
    const cases: Array<{ body: string; expected: string }> = [
      // Bare (non-JSON) string payload — the connector would otherwise type it as text.
      { body: 'event: error\ndata: rate limited\n\n', expected: 'rate limited' },
      // JSON object error payload.
      { body: 'event: error\ndata: {"error":"quota exceeded"}\n\n', expected: 'quota exceeded' },
      // Bare JSON string payload.
      { body: 'event: error\ndata: "overloaded"\n\n', expected: 'overloaded' },
      // JSON object with no recognisable error field — falls back to the raw payload.
      { body: 'event: error\ndata: {"status":"bad"}\n\n', expected: '{"status":"bad"}' },
      // Empty data payload — still surfaces an error rather than being silently dropped.
      { body: 'event: error\ndata:\n\n', expected: 'SSE `event: error` frame' },
    ];

    for (const { body, expected } of cases) {
      const transport = vi.fn<Transport>(async () => makeResponse(body));
      const onChunk = vi.fn();
      const onError = vi.fn();
      const { result } = renderHook(() => useChorusStream(transport));

      let sendError: unknown;
      await act(async () => {
        await result.current.send('hi', [], { onChunk, onError }).catch(err => { sendError = err; });
      });

      expect(onChunk).not.toHaveBeenCalled();
      expect(sendError).toBeInstanceOf(ChorusStreamError);
      expect((sendError as Error).message).toBe(expected);
      expect(onError).toHaveBeenCalledTimes(1);
    }
  });

  it('does not type text for a named event: heartbeat keepalive frame', async () => {
    const transport = vi.fn<Transport>(async () => makeResponse('event: heartbeat\ndata: {}\n\ndata: hello\n\n'));
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await result.current.send('hi', [], { onChunk, onDone, minDelayMs: 0 });
    });

    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('hello');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('delivers chunks without extra delay when the transport is slower than minDelayMs', async () => {
    vi.useFakeTimers();
    try {
      let resolveTransport!: (response: Response) => void;
      const transport = vi.fn<Transport>(() => new Promise<Response>(resolve => {
        resolveTransport = resolve;
      }));
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const { result } = renderHook(() => useChorusStream(transport));

      let sendPromise!: Promise<void>;
      act(() => {
        sendPromise = result.current.send('hello', [], { onChunk, onDone, minDelayMs: 200 });
      });

      // Transport itself takes 600ms — longer than minDelayMs.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(onChunk).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();

      // Resolving the transport must deliver and finalize without scheduling any further timer:
      // if finish() had set a setTimeout, awaiting sendPromise here would hang since
      // no timers are advanced after this point.
      await act(async () => {
        resolveTransport(makeResponse());
        await sendPromise;
      });
      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('delays the first chunk until minDelayMs has elapsed', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse(['token'])));
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    const sendPromise = result.current.send('hello', [], { onChunk, onDone, minDelayMs: 1000 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });

    expect(onChunk).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await sendPromise;
    });

    expect(onChunk).toHaveBeenCalledWith('token');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: 'onChunk',
      connector: undefined,
      tokens: ['token'],
      callbacks: (error: Error) => ({
        onChunk: () => { throw error; },
      }),
    },
    {
      name: 'onStart',
      connector: undefined,
      tokens: ['token'],
      callbacks: (error: Error) => ({
        onStart: () => { throw error; },
      }),
    },
    {
      name: 'onReasoning',
      connector: 'openai' as const,
      tokens: [JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'plan' } }] }), '[DONE]'],
      callbacks: (error: Error) => ({
        onReasoning: () => { throw error; },
      }),
    },
    {
      name: 'onToolDelta',
      connector: 'openai' as const,
      tokens: [JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"test"}' } }] } }] }), '[DONE]'],
      callbacks: (error: Error) => ({
        onToolDelta: () => { throw error; },
      }),
    },
  ])('rejects send without an unhandled timer exception when delayed $name throws', async ({ connector, tokens, callbacks, name }) => {
    vi.useFakeTimers();
    const callbackError = new Error(`${name} failed`);
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse(tokens)));
    const onDone = vi.fn();
    const onError = vi.fn();
    const uncaught = vi.fn();
    const unhandled = vi.fn();
    process.on('uncaughtException', uncaught);
    process.on('unhandledRejection', unhandled);

    try {
      const { result } = renderHook(() => useChorusStream(transport, connector ? { connector } : undefined));
      const sendPromise = result.current.send('hello', [], {
        onChunk: vi.fn(),
        ...callbacks(callbackError),
        onDone,
        onError,
        minDelayMs: 100,
      });
      const rejection = expect(sendPromise).rejects.toThrow(callbackError.message);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
        await rejection;
      });

      expect(onDone).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(callbackError);
      expect(uncaught).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
      expect(result.current.sending).toBe(false);
    } finally {
      process.off('uncaughtException', uncaught);
      process.off('unhandledRejection', unhandled);
      vi.useRealTimers();
    }
  });
});
