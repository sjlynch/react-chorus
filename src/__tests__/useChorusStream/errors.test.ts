import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChorusStream, type Transport } from '../../hooks/useChorusStream';
import { ChorusStreamError } from '../../streaming/errors';
import { makeAbortError, makeOpenSseResponse, makeSseResponse, resetUseChorusStreamTestEnv } from './fixtures';

// ---------------------------------------------------------------------------

describe('useChorusStream error handling', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(resetUseChorusStreamTestEnv);

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

  it('surfaces a connector error even when the error string is empty', async () => {
    // A provider that emits `error: ''` is still reporting a failure; the empty
    // string must not be treated as 'no error' or the stream completes silently.
    const emptyErrorConnector = {
      name: 'empty-error-test',
      extract: () => ({ error: '' }),
    };
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse(['anything'])));
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport, { connector: emptyErrorConnector }));

    let rejection: unknown;
    await act(async () => {
      rejection = await result.current.send('hello', [], { onChunk, onDone, onError }).then(
        () => undefined,
        (err) => err,
      );
    });

    expect(rejection).toBeInstanceOf(ChorusStreamError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(ChorusStreamError);
    expect(onDone).not.toHaveBeenCalled();
    expect(result.current.sending).toBe(false);
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
