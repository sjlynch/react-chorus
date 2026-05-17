import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
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

function makeControlledSseResponse() {
  const encoder = new TextEncoder();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });

  return {
    response: new Response(stream),
    emit(payload: string) {
      streamController.enqueue(encoder.encode(`data: ${payload}\n\n`));
    },
    close() {
      streamController.close();
    },
  };
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
      await expect(result.current.send('hello', [], { onChunk, onDone, onError })).rejects.toThrow('provider failed mid-stream');
    });

    expect(onChunk).toHaveBeenCalledWith('partial');
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('provider failed mid-stream');
    expect(onError.mock.calls[0][0].errorPayload).toEqual({ error: 'provider failed mid-stream' });
    expect(cancelled).toBe(true);
    expect(result.current.sending).toBe(false);
  });

  it.each([
    {
      connector: 'anthropic' as const,
      payload: { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } },
      message: 'overloaded',
    },
    {
      connector: 'gemini' as const,
      payload: { candidates: [{ finishReason: 'SAFETY', content: { parts: [] }, safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT' }] }] },
      message: 'Gemini response was blocked and returned no text (finishReason: SAFETY)',
    },
  ])('surfaces $connector errorPayload through useChorusStream', async ({ connector, payload, message }) => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse([JSON.stringify(payload)])));
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector }));

    await act(async () => {
      await expect(result.current.send('hello', [], { onChunk: vi.fn(), onError })).rejects.toThrow(message);
    });

    expect(onError.mock.calls[0][0].errorPayload).toEqual(payload);
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

  it('calls onError instead of onDone when transport throws a non-abort error', async () => {
    const error = new Error('network failed');
    const transport = vi.fn<Transport>(() => Promise.reject(error));
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await expect(result.current.send('hello', [], { onChunk: vi.fn(), onDone, onError })).rejects.toThrow('network failed');
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

  it('abort() cancels a response reader even when the stream ignores the transport signal', async () => {
    let cancelled = false;
    const transport = vi.fn<Transport>(() => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    }))));
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = result.current.send('hello', [], { onChunk: vi.fn(), onDone, onError });
      await Promise.resolve();
    });

    expect(result.current.sending).toBe(true);

    await act(async () => {
      result.current.abort();
      await sendPromise;
    });

    expect(cancelled).toBe(true);
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

  it('does nothing and warns in development when send() is called while already sending', async () => {
    const response = deferred<Response>();
    const transport = vi.fn<Transport>(() => response.promise);
    const onChunk = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
    expect(warn).toHaveBeenCalledWith('[Chorus] useChorusStream.send was called while a previous send is still in flight; the new call was ignored. Wait for the previous send to finish (await the promise) or call abort() before re-sending.');

    await act(async () => {
      response.resolve(makeSseResponse(['only-once']));
      await firstSend;
    });

    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('only-once');
    warn.mockRestore();
  });

  it('aborts the active transport when the hook unmounts', async () => {
    let capturedSignal!: AbortSignal;
    const transport = vi.fn<Transport>((_text, _history, signal) => {
      capturedSignal = signal;
      return new Promise<Response>(() => undefined);
    });
    const { result, unmount } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      void result.current.send('hello', [], { onChunk: vi.fn() });
    });

    expect(capturedSignal.aborted).toBe(false);
    unmount();
    expect(capturedSignal.aborted).toBe(true);
  });

  it('short-circuits pre-aborted external signals before calling the transport', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse(['unused'])));
    const { result } = renderHook(() => useChorusStream(transport));
    const controller = new AbortController();
    controller.abort();

    await act(async () => {
      await result.current.send('hello', [], { onChunk: vi.fn() }, controller.signal);
    });

    expect(transport).not.toHaveBeenCalled();
    expect(result.current.sending).toBe(false);
  });

  it('rejects with HTTP JSON error response details', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(new Response(JSON.stringify({ error: 'missing API key' }), {
      status: 400,
      statusText: 'Bad Request',
    })));
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await expect(result.current.send('hello', [], { onChunk: vi.fn(), onError })).rejects.toThrow(/HTTP 400 Bad Request: \{"error":"missing API key"\}/);
    });

    expect(onError.mock.calls[0][0].message).toContain('missing API key');
    expect(result.current.sending).toBe(false);
  });

  it('rejects with HTTP text error response details', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(new Response('upstream exploded', {
      status: 500,
      statusText: 'Internal Server Error',
    })));
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await expect(result.current.send('hello', [], { onChunk: vi.fn() })).rejects.toThrow('HTTP 500 Internal Server Error: upstream exploded');
    });
  });

  it('includes slow HTTP error bodies within the extended timeout', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode('slow upstream failure'));
          controller.close();
        }, 1000);
      },
    });
    const transport = vi.fn<Transport>(() => Promise.resolve(new Response(stream, { status: 502 })));
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await expect(result.current.send('hello', [], { onChunk: vi.fn() })).rejects.toThrow('HTTP 502: slow upstream failure');
    });
  });

  it('truncates oversized HTTP error bodies', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(new Response('x'.repeat(3000), { status: 500 })));
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await expect(result.current.send('hello', [], { onChunk: vi.fn(), onError })).rejects.toThrow(/HTTP 500: x+…/);
    });

    expect(onError.mock.calls[0][0].message.length).toBeLessThan(2100);
  });

  it('rejects 200 application/json bodies that contain no SSE data lines and surfaces the error through onError', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(new Response(
      JSON.stringify({ error: 'missing API key' }),
      { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } },
    )));
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await expect(result.current.send('hello', [], { onChunk, onDone, onError }))
        .rejects.toThrow(/Server-Sent Events.*`data:` lines/);
    });

    expect(onChunk).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const surfacedError = onError.mock.calls[0][0];
    expect(surfacedError.message).toContain('application/json');
    expect(surfacedError.message).toContain('missing API key');
    expect(result.current.sending).toBe(false);
  });

  it('rejects 200 text/plain bodies that contain no SSE data lines and surfaces the error through onError', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(new Response(
      'hello from the wrong endpoint',
      { status: 200, statusText: 'OK', headers: { 'content-type': 'text/plain; charset=utf-8' } },
    )));
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await expect(result.current.send('hello', [], { onChunk, onDone, onError }))
        .rejects.toThrow(/Server-Sent Events/);
    });

    expect(onChunk).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const surfacedError = onError.mock.calls[0][0];
    expect(surfacedError.message).toContain('text/plain');
    expect(surfacedError.message).toContain('hello from the wrong endpoint');
    expect(result.current.sending).toBe(false);
  });

  it('reports missing response bodies separately', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(new Response(null, { status: 200 })));
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await expect(result.current.send('hello', [], { onChunk: vi.fn() })).rejects.toThrow('Response body was missing for HTTP 200');
    });
  });

  it('rejects transport failures even when no onError callback is supplied', async () => {
    const transportError = new Error('proxy failed');
    const transport = vi.fn<Transport>(() => Promise.reject(transportError));
    const { result } = renderHook(() => useChorusStream(transport));

    await act(async () => {
      await expect(result.current.send('hello', [], { onChunk: vi.fn() })).rejects.toThrow('proxy failed');
    });

    expect(result.current.sending).toBe(false);
  });

  it('preserves the original stream error when onError throws while handling it', async () => {
    const transportError = new Error('network failed');
    const callbackError = new Error('observer failed');
    const transport = vi.fn<Transport>(() => Promise.reject(transportError));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useChorusStream(transport));

    try {
      await act(async () => {
        await expect(result.current.send('hello', [], {
          onChunk: vi.fn(),
          onError: () => { throw callbackError; },
        })).rejects.toBe(transportError);
      });

      expect(warn).toHaveBeenCalledWith('[Chorus] `onError` callback threw and was ignored so the original stream error could be re-thrown.', callbackError);
      expect(result.current.sending).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});
