import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChorusStream, type Transport } from '../../hooks/useChorusStream';
import { ChorusStreamError } from '../../streaming/errors';
import type { Message } from '../../types';
import { deferred, makeAbortError, makeResponse, makeSseResponse, resetUseChorusStreamTestEnv } from './fixtures';

// ---------------------------------------------------------------------------

describe('useChorusStream lifecycle', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(resetUseChorusStreamTestEnv);

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

  it('rejects with a concurrent-send ChorusStreamError when send() is called while already sending', async () => {
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

    const expectedMessage = '[Chorus] useChorusStream.send was called while a previous send is still in flight; the new call was ignored. Wait for the previous send to finish (await the promise) or call abort() before re-sending.';

    let rejection: unknown;
    await act(async () => {
      rejection = await result.current.send('second', [], { onChunk }).then(
        () => undefined,
        (err) => err,
      );
    });

    expect(rejection).toBeInstanceOf(ChorusStreamError);
    expect((rejection as ChorusStreamError).code).toBe('concurrent-send');
    expect((rejection as ChorusStreamError).message).toBe(expectedMessage);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith('first', [], expect.any(AbortSignal));
    expect(warn).toHaveBeenCalledWith(expectedMessage);

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

  it('rejects with an already-aborted ChorusStreamError when send() is called with a pre-aborted externalSignal', async () => {
    const transport = vi.fn<Transport>(() => Promise.resolve(makeSseResponse(['unused'])));
    const onChunk = vi.fn();
    const { result } = renderHook(() => useChorusStream(transport));
    const controller = new AbortController();
    controller.abort();

    let rejection: unknown;
    await act(async () => {
      rejection = await result.current.send('hello', [], { onChunk }, controller.signal).then(
        () => undefined,
        (err) => err,
      );
    });

    expect(rejection).toBeInstanceOf(ChorusStreamError);
    expect((rejection as ChorusStreamError).code).toBe('already-aborted');
    expect((rejection as ChorusStreamError).message).toContain('already aborted');
    expect(transport).not.toHaveBeenCalled();
    expect(onChunk).not.toHaveBeenCalled();
    expect(result.current.sending).toBe(false);
  });

  it('warns in dev when abort() is called while a send started with an externalSignal is in flight', async () => {
    let capturedSignal!: AbortSignal;
    const transport = vi.fn<Transport>((_text, _history, signal) => {
      capturedSignal = signal;
      return new Promise<Response>(() => undefined);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useChorusStream(transport));
    const externalController = new AbortController();

    try {
      await act(async () => {
        void result.current.send('hello', [], { onChunk: vi.fn() }, externalController.signal);
      });

      expect(result.current.sending).toBe(true);
      expect(capturedSignal).toBe(externalController.signal);

      act(() => {
        result.current.abort();
      });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/externalSignal/);
      expect(warn.mock.calls[0][0]).toMatch(/cannot cancel/);
      expect(capturedSignal.aborted).toBe(false);
    } finally {
      warn.mockRestore();
      externalController.abort();
    }
  });

  it('warns in dev when the hook unmounts while a send started with an externalSignal is in flight', async () => {
    const transport = vi.fn<Transport>(() => new Promise<Response>(() => undefined));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useChorusStream(transport));
    const externalController = new AbortController();

    try {
      await act(async () => {
        void result.current.send('hello', [], { onChunk: vi.fn() }, externalController.signal);
      });

      unmount();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/unmounted/);
      expect(warn.mock.calls[0][0]).toMatch(/externalSignal/);
    } finally {
      warn.mockRestore();
      externalController.abort();
    }
  });

  it('removes the forwardAbort listener from a caller-owned externalSignal when the hook unmounts mid-send', async () => {
    const transport = vi.fn<Transport>(() => new Promise<Response>(() => undefined));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const externalController = new AbortController();
    const addSpy = vi.spyOn(externalController.signal, 'addEventListener');
    const removeSpy = vi.spyOn(externalController.signal, 'removeEventListener');
    const { result, unmount } = renderHook(() => useChorusStream(transport));

    try {
      await act(async () => {
        void result.current.send('hello', [], { onChunk: vi.fn() }, externalController.signal);
      });

      const forwardAbort = addSpy.mock.calls.find(([type]) => type === 'abort')?.[1];
      expect(forwardAbort).toBeTypeOf('function');

      unmount();

      // The hook does not own the externalSignal, so its in-flight send keeps
      // running — but the forwardAbort listener it installed must be detached
      // so a long-lived signal does not leak listeners across mount/unmount.
      expect(removeSpy).toHaveBeenCalledWith('abort', forwardAbort);
    } finally {
      warn.mockRestore();
      externalController.abort();
    }
  });

  it('balances forwardAbort listener registrations across repeated mount/unmount cycles on one externalSignal', async () => {
    const transport = vi.fn<Transport>(() => new Promise<Response>(() => undefined));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const externalController = new AbortController();
    const addSpy = vi.spyOn(externalController.signal, 'addEventListener');
    const removeSpy = vi.spyOn(externalController.signal, 'removeEventListener');

    try {
      for (let i = 0; i < 3; i += 1) {
        const { result, unmount } = renderHook(() => useChorusStream(transport));
        await act(async () => {
          void result.current.send('hello', [], { onChunk: vi.fn() }, externalController.signal);
        });
        unmount();
      }

      const added = addSpy.mock.calls.filter(([type]) => type === 'abort').length;
      const removed = removeSpy.mock.calls.filter(([type]) => type === 'abort').length;
      expect(added).toBe(3);
      expect(removed).toBe(added);
    } finally {
      warn.mockRestore();
      externalController.abort();
    }
  });
});
