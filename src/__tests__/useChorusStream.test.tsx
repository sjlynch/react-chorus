import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChorusStream, type Transport } from '../hooks/useChorusStream';

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
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      const first = result.current.send('hello', [], { onChunk });
      const second = result.current.send('hello again', [], { onChunk });
      await Promise.all([first, second]);
    });

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith('hello', [], expect.any(AbortSignal));
    expect(onChunk).toHaveBeenCalledTimes(1);
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
