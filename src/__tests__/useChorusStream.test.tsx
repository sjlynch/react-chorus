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
});
