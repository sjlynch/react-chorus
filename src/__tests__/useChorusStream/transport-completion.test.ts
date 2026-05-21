import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChorusStream } from '../../hooks/useChorusStream';
import { createFetchSSETransport } from '../../streaming/createFetchSSETransport';
import { createWebSocketTransport } from '../../streaming/createWebSocketTransport';
import { makeOpenSseResponse, MockWebSocket, resetUseChorusStreamTestEnv } from './fixtures';

// ---------------------------------------------------------------------------

describe('useChorusStream transport completion', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(resetUseChorusStreamTestEnv);

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
});
