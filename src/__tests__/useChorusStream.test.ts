import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChorusStream, type Transport } from '../hooks/useChorusStream';
import { createFetchSSETransport } from '../streaming/createFetchSSETransport';
import { createWebSocketTransport } from '../streaming/createWebSocketTransport';
import type { Message } from '../types';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSseResponse(tokens: string[]): Response {
  const body = tokens.map(token => `data: ${token}\n\n`).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream);
}

function makeOpenSseResponse(tokens: string[], onCancel?: () => void): Response {
  const body = tokens.map(token => `data: ${token}\n\n`).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
    },
    cancel() {
      onCancel?.();
    },
  });
  return new Response(stream);
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(public url: string, public protocols?: string | string[]) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  emitOpen() {
    this.onopen?.(new Event('open'));
  }

  emitMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function makeAbortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError') as Error;
}

// ---------------------------------------------------------------------------

describe('useChorusStream', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
  });

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

  it('finishes a fetch transport when the connector emits a done sentinel and the body stays open', async () => {
    let cancelled = false;
    const fetchMock = vi.fn(async () => makeOpenSseResponse(['[DONE]'], () => { cancelled = true; }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = createFetchSSETransport('/api/chat');
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'openai' }));

    await act(async () => {
      await result.current.send('hello', [], { onChunk: vi.fn(), onDone, onError });
    });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(cancelled).toBe(true);
    expect(result.current.sending).toBe(false);
  });

  it('finishes a WebSocket transport when the connector emits a done sentinel and the socket stays open', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const transport = createWebSocketTransport('wss://api.example.com/chat');
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'openai' }));

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = result.current.send('hello', [], { onChunk: vi.fn(), onDone, onError });
    });

    const ws = MockWebSocket.instances[0];
    expect(result.current.sending).toBe(true);

    await act(async () => {
      ws.emitOpen();
      await Promise.resolve();
    });

    await act(async () => {
      ws.emitMessage('[DONE]');
      await sendPromise;
    });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(ws.closed).toBe(true);
    expect(result.current.sending).toBe(false);
  });

  it('surfaces an in-band error payload through onError and cancels the stream', async () => {
    let cancelled = false;
    const errorPayload = JSON.stringify({ error: 'provider failed mid-stream' });
    const transport = vi.fn<Transport>(() => Promise.resolve(makeOpenSseResponse([
      JSON.stringify({ choices: [{ delta: { content: 'partial' } }] }),
      errorPayload,
    ], () => { cancelled = true; })));
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: 'openai' }));

    await act(async () => {
      await result.current.send('hello', [], { onChunk, onDone, onError });
    });

    expect(onChunk).toHaveBeenCalledWith('partial');
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('provider failed mid-stream');
    expect(cancelled).toBe(true);
    expect(result.current.sending).toBe(false);
  });

  it('calls onError instead of onDone when transport throws a non-abort error', async () => {
    const error = new Error('network failed');
    const transport = vi.fn<Transport>(() => Promise.reject(error));
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await result.current.send('hello', [], { onChunk: vi.fn(), onDone, onError });
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
    expect(onDone).not.toHaveBeenCalled();
    expect(result.current.sending).toBe(false);
  });

  it('does not call onError when transport throws AbortError', async () => {
    const transport = vi.fn<Transport>(() => Promise.reject(makeAbortError()));
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await result.current.send('hello', [], { onChunk: vi.fn(), onDone, onError });
    });

    expect(onError).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(result.current.sending).toBe(false);
  });

  it('abort() cancels an in-flight send', async () => {
    let capturedSignal!: AbortSignal;
    const transport = vi.fn<Transport>((_text: string, _history: Message[], signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(makeAbortError()), { once: true });
      });
    });
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = result.current.send('hello', [], { onChunk: vi.fn(), onDone, onError });
    });

    expect(result.current.sending).toBe(true);
    expect(capturedSignal.aborted).toBe(false);

    await act(async () => {
      result.current.abort();
      await sendPromise;
    });

    expect(capturedSignal.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(result.current.sending).toBe(false);
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

  it('does nothing when send() is called while already sending', async () => {
    const response = deferred<Response>();
    const transport = vi.fn<Transport>(() => response.promise);
    const onChunk = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    let firstSend!: Promise<void>;
    await act(async () => {
      firstSend = result.current.send('first', [], { onChunk });
    });

    expect(result.current.sending).toBe(true);

    await act(async () => {
      await result.current.send('second', [], { onChunk });
    });

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith('first', [], expect.any(AbortSignal));

    await act(async () => {
      response.resolve(makeSseResponse(['only-once']));
      await firstSend;
    });

    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('only-once');
  });
});
