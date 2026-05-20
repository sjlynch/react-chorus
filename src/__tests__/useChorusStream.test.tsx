import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChorusStream, type Transport } from '../hooks/useChorusStream';
import { ChorusStreamError } from '../streaming/errors';

function makeResponse(body = 'data: hello\n\n'): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream);
}

describe('useChorusStream', () => {
  it('prevents synchronous double sends before React state updates flush', async () => {
    const transport = vi.fn<Transport>(async () => makeResponse());
    const onChunk = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useChorusStream(transport));

    let secondError: unknown;
    await act(async () => {
      const first = result.current.send('hello', [], { onChunk });
      const second = result.current.send('hello again', [], { onChunk }).catch((err) => {
        secondError = err;
      });
      await Promise.all([first, second]);
    });

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith('hello', [], expect.any(AbortSignal));
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(secondError).toBeInstanceOf(ChorusStreamError);
    expect((secondError as ChorusStreamError).code).toBe('concurrent-send');
    warn.mockRestore();
  });

  it('keeps the send callback stable across sending state changes', async () => {
    let resolveTransport!: (response: Response) => void;
    const transport = vi.fn<Transport>(() => new Promise<Response>(resolve => {
      resolveTransport = resolve;
    }));
    const onChunk = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));
    const initialSend = result.current.send;
    let sendPromise!: Promise<void>;

    act(() => {
      sendPromise = result.current.send('hello', [], { onChunk });
    });

    expect(result.current.sending).toBe(true);
    expect(result.current.send).toBe(initialSend);

    await act(async () => {
      resolveTransport(makeResponse());
      await sendPromise;
    });

    expect(result.current.sending).toBe(false);
    expect(result.current.send).toBe(initialSend);
  });

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
});
