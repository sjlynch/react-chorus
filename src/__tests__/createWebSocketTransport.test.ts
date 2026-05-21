import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSSEStream } from '../hooks/useChorusStream';
import { createWebSocketTransport } from '../streaming/createWebSocketTransport';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  protocols?: string | string[];
  sent: string[] = [];
  closedWith: Array<{ code?: number; reason?: string }> = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closedWith.push({ code, reason });
  }

  emitOpen() {
    this.onopen?.(new Event('open'));
  }

  emitClose(code = 1000, reason = '') {
    this.onclose?.({ code, reason } as CloseEvent);
  }

  emitError(event = new Event('error')) {
    this.onerror?.(event);
  }
}

describe('createWebSocketTransport', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls lifecycle callbacks without replacing the normal response flow', async () => {
    const events: string[] = [];
    const transport = createWebSocketTransport('wss://api.example.com/chat', {
      onOpen: () => events.push('open'),
      onClose: (code, reason) => events.push(`close:${code}:${reason}`),
    });

    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    ws.emitClose(1000, 'done');

    expect(response.ok).toBe(true);
    expect(ws.sent).toEqual(['{"prompt":"hello","history":[]}']);
    expect(events).toEqual(['open', 'close:1000:done']);
  });

  it('rejects when the socket closes before it opens and still calls onClose', async () => {
    const events: string[] = [];
    const transport = createWebSocketTransport('wss://api.example.com/chat', {
      onClose: (code, reason) => events.push(`close:${code}:${reason}`),
    });

    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitClose(1006, 'handshake failed');

    await expect(promise).rejects.toThrow(/code 1006: handshake failed/);
    expect(events).toEqual(['close:1006:handshake failed']);
  });

  it('calls onError in addition to rejecting the transport', async () => {
    const errorEvent = new Event('error');
    const events: string[] = [];
    const transport = createWebSocketTransport('wss://api.example.com/chat', {
      onError: (event) => events.push(event === errorEvent ? 'error' : 'wrong-event'),
    });

    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitError(errorEvent);

    await expect(promise).rejects.toThrow('WebSocket connection error');
    expect(events).toEqual(['error']);
  });

  it('rejects and closes the socket when formatMessage throws on open', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat', {
      formatMessage: () => { throw new Error('serialize failed'); },
    });
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];
    const closeSpy = vi.spyOn(ws, 'close');

    ws.emitOpen();

    await expect(promise).rejects.toThrow('serialize failed');
    expect(closeSpy).toHaveBeenCalled();
  });

  it('rejects and closes the socket when ws.send throws on open', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat');
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];
    const sendError = new Error('send failed');
    vi.spyOn(ws, 'send').mockImplementation(() => { throw sendError; });
    const closeSpy = vi.spyOn(ws, 'close');

    ws.emitOpen();

    await expect(promise).rejects.toThrow('send failed');
    expect(closeSpy).toHaveBeenCalled();
  });

  it('enqueues each WS message as an SSE-formatted chunk on the response body', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat');
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    ws.onmessage?.({ data: '{"chunk":"hi"}' } as MessageEvent);
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(decoder.decode(first.value)).toBe('data: {"chunk":"hi"}\n\n');

    ws.onmessage?.({ data: '{"chunk":" there"}' } as MessageEvent);
    const second = await reader.read();
    expect(decoder.decode(second.value)).toBe('data: {"chunk":" there"}\n\n');
  });

  it('decodes ArrayBuffer WS messages as text payloads', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat');
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    ws.onmessage?.({ data: new TextEncoder().encode('{"chunk":"binary"}').buffer } as MessageEvent);
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(decoder.decode(first.value)).toBe('data: {"chunk":"binary"}\n\n');
  });

  it('preserves embedded newlines in a WS message as one SSE payload', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat');
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    const events: string[] = [];
    const readPromise = readSSEStream(response, payload => {
      events.push(payload);
      return false;
    });

    ws.onmessage?.({ data: 'hello\nworld' } as MessageEvent);
    await readPromise;

    expect(events).toEqual(['hello\nworld']);
  });

  it('closes the response stream when the WS closes', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat');
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    const reader = response.body!.getReader();

    ws.emitClose(1000, 'done');

    const result = await reader.read();
    expect(result.done).toBe(true);
    expect(result.value).toBeUndefined();
  });

  it('treats a normal 1000 close after a chunk as clean EOF in transient mode', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat');
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    ws.onmessage?.({ data: '{"chunk":"hi"}' } as MessageEvent);
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe('data: {"chunk":"hi"}\n\n');

    ws.emitClose(1000, 'done');
    const next = await reader.read();
    expect(next.done).toBe(true);
  });

  it('errors the response stream on abnormal 1006 close after a chunk in transient mode', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat');
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    ws.onmessage?.({ data: '{"chunk":"hi"}' } as MessageEvent);
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe('data: {"chunk":"hi"}\n\n');

    ws.emitClose(1006, 'abnormal');
    await expect(reader.read()).rejects.toThrow(/code 1006: abnormal/);
  });

  it('errors the response stream on abnormal 1011 close after a chunk in transient mode', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat');
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    const reader = response.body!.getReader();

    ws.onmessage?.({ data: '{"chunk":"partial"}' } as MessageEvent);
    await reader.read();

    ws.emitClose(1011, 'server error');
    await expect(reader.read()).rejects.toThrow(/code 1011: server error/);
  });

  it('errors the in-flight response stream when transport.close() is called mid-stream in transient mode', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat');
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    ws.onmessage?.({ data: '{"chunk":"partial"}' } as MessageEvent);
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe('data: {"chunk":"partial"}\n\n');

    // Client tears the socket down (e.g. hot-reload teardown) mid-stream.
    transport.close();

    // The reader must reject rather than report a silent, truncated `done`.
    await expect(reader.read()).rejects.toThrow(/transport closed by client/);
    expect(ws.closedWith.length).toBeGreaterThan(0);
  });

  it('rejects the outer promise when transport.close() is called before the socket opens in transient mode', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat');
    const promise = transport('hello', [], new AbortController().signal);

    // Socket is still connecting — the send promise has not resolved yet.
    transport.close();

    await expect(promise).rejects.toThrow(/transport closed by client/);
  });

  it('forwards the close code and reason to the socket and into the stream error in transient mode', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat');
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    const reader = response.body!.getReader();

    transport.close(4000, 'unmounting');

    expect(ws.closedWith).toEqual([{ code: 4000, reason: 'unmounting' }]);
    await expect(reader.read()).rejects.toThrow(/code 4000: unmounting/);
  });

  it('errors active streams on abnormal 1006 close in persistent mode', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat', { persistent: true });
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    ws.onmessage?.({ data: '{"chunk":"hi"}' } as MessageEvent);
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe('data: {"chunk":"hi"}\n\n');

    ws.emitClose(1006, 'abnormal');
    await expect(reader.read()).rejects.toThrow(/code 1006: abnormal/);
  });

  it('errors active streams on abnormal 1011 close in persistent mode', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat', { persistent: true });
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    const reader = response.body!.getReader();

    ws.onmessage?.({ data: '{"chunk":"partial"}' } as MessageEvent);
    await reader.read();

    ws.emitClose(1011, 'server error');
    await expect(reader.read()).rejects.toThrow(/code 1011: server error/);
  });

  it('closes active streams cleanly on a normal 1000 close in persistent mode', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat', { persistent: true });
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    ws.onmessage?.({ data: '{"chunk":"hi"}' } as MessageEvent);
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe('data: {"chunk":"hi"}\n\n');

    ws.emitClose(1000, 'done');
    const next = await reader.read();
    expect(next.done).toBe(true);
  });

  it('errors active streams when transport.close() is called mid-stream in persistent mode', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat', { persistent: true });
    const promise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];

    ws.emitOpen();
    const response = await promise;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    ws.onmessage?.({ data: '{"chunk":"partial"}' } as MessageEvent);
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe('data: {"chunk":"partial"}\n\n');

    // Client closes the shared socket while a response is still streaming.
    transport.close();

    await expect(reader.read()).rejects.toThrow(/transport closed by client/);
  });

  it('removes aborted open waiters without closing a connecting persistent socket', async () => {
    const firstController = new AbortController();
    const secondController = new AbortController();
    const transport = createWebSocketTransport('wss://api.example.com/chat', {
      persistent: true,
      correlate: () => null,
    });

    const firstPromise = transport('one', [], firstController.signal);
    const ws = MockWebSocket.instances[0];
    const secondPromise = transport('two', [], secondController.signal);

    firstController.abort();

    await expect(firstPromise).rejects.toThrow('Aborted');

    ws.emitOpen();
    const secondResponse = await secondPromise;

    expect(secondResponse.ok).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(ws.closedWith).toEqual([]);
    expect(ws.sent).toEqual(['{"prompt":"two","history":[]}']);
  });

  it('closes the WS and errors the stream when the AbortSignal fires after open', async () => {
    const controller = new AbortController();
    const transport = createWebSocketTransport('wss://api.example.com/chat');
    const promise = transport('hello', [], controller.signal);
    const ws = MockWebSocket.instances[0];
    const closeSpy = vi.spyOn(ws, 'close');

    ws.emitOpen();
    const response = await promise;
    const reader = response.body!.getReader();

    controller.abort();

    expect(closeSpy).toHaveBeenCalled();
    await expect(reader.read()).rejects.toThrow('Aborted');
  });

  it('opens a fresh socket for each send by default', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat');

    const firstPromise = transport('one', [], new AbortController().signal);
    const first = MockWebSocket.instances[0];
    first.emitOpen();
    await firstPromise;
    first.emitClose(1000, 'done');

    const secondPromise = transport('two', [], new AbortController().signal);
    const second = MockWebSocket.instances[1];
    second.emitOpen();
    await secondPromise;

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(first.sent).toEqual(['{"prompt":"one","history":[]}']);
    expect(second.sent).toEqual(['{"prompt":"two","history":[]}']);
  });

  it('reuses one socket across sends in persistent mode and closes it explicitly', async () => {
    const events: string[] = [];
    const transport = createWebSocketTransport('wss://api.example.com/chat', {
      persistent: true,
      onOpen: () => events.push('open'),
      onClose: (code, reason) => events.push(`close:${code}:${reason}`),
    });

    const firstPromise = transport('one', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    const firstResponse = await firstPromise;
    const firstReader = firstResponse.body!.getReader();

    ws.onmessage?.({ data: '{"chunk":"first"}' } as MessageEvent);
    const firstChunk = await firstReader.read();
    expect(new TextDecoder().decode(firstChunk.value)).toBe('data: {"chunk":"first"}\n\n');
    await firstReader.cancel();

    const secondResponse = await transport('two', [], new AbortController().signal);
    const secondReader = secondResponse.body!.getReader();

    ws.onmessage?.({ data: '{"chunk":"second"}' } as MessageEvent);
    const secondChunk = await secondReader.read();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(ws.sent).toEqual(['{"prompt":"one","history":[]}', '{"prompt":"two","history":[]}']);
    expect(new TextDecoder().decode(secondChunk.value)).toBe('data: {"chunk":"second"}\n\n');
    expect(events).toEqual(['open']);

    transport.close(1000, 'client done');
    expect(ws.closedWith).toEqual([{ code: 1000, reason: 'client done' }]);

    ws.emitClose(1000, 'client done');
    expect(events).toEqual(['open', 'close:1000:client done']);
  });

  it('observes persistent server-pushed messages when no send stream is active', async () => {
    const pushed: string[] = [];
    const transport = createWebSocketTransport('wss://api.example.com/chat', {
      persistent: true,
      onMessage: (data) => pushed.push(data),
    });

    const responsePromise = transport('hello', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    const response = await responsePromise;
    await response.body!.cancel();

    ws.onmessage?.({ data: 'volunteer update' } as MessageEvent);
    await Promise.resolve();

    expect(pushed).toEqual(['volunteer update']);
  });

  it('warns once in dev when persistent sends overlap without a correlate callback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const transport = createWebSocketTransport('wss://api.example.com/chat', { persistent: true });

      const firstPromise = transport('one', [], new AbortController().signal);
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();
      await firstPromise;

      // First send's response stream is still active (not cancelled/closed).
      // Start a second send — the warning should fire.
      const secondPromise = transport('two', [], new AbortController().signal);
      await secondPromise;

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatch(/persistent WebSocket/);
      expect(warn.mock.calls[0]![0]).toMatch(/correlate/);

      // Third overlapping send should not re-fire (warn-once per transport).
      await transport('three', [], new AbortController().signal);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn when persistent sends do not overlap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const transport = createWebSocketTransport('wss://api.example.com/chat', { persistent: true });

      const firstPromise = transport('one', [], new AbortController().signal);
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();
      const firstResponse = await firstPromise;
      await firstResponse.body!.cancel();

      // Previous stream has been cleared, so a follow-up send should not warn.
      await transport('two', [], new AbortController().signal);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn when overlapping persistent sends provide a correlate callback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const transport = createWebSocketTransport('wss://api.example.com/chat', {
        persistent: true,
        formatMessage: (text) => ({ payload: text, correlationId: text }),
        correlate: () => null,
      });

      const firstPromise = transport('one', [], new AbortController().signal);
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();
      await firstPromise;

      await transport('two', [], new AbortController().signal);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('routes correlated frames only to the matching response stream', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat', {
      persistent: true,
      formatMessage: (text) => ({
        payload: JSON.stringify({ id: text, prompt: text }),
        correlationId: text,
      }),
      correlate: (frame) => {
        try { return (JSON.parse(frame) as { id?: string }).id ?? null; } catch { return null; }
      },
    });

    const firstPromise = transport('one', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    const firstResponse = await firstPromise;
    const firstReader = firstResponse.body!.getReader();

    const secondPromise = transport('two', [], new AbortController().signal);
    const secondResponse = await secondPromise;
    const secondReader = secondResponse.body!.getReader();

    const decoder = new TextDecoder();

    ws.onmessage?.({ data: JSON.stringify({ id: 'one', token: 'A1' }) } as MessageEvent);
    await Promise.resolve();
    ws.onmessage?.({ data: JSON.stringify({ id: 'two', token: 'B1' }) } as MessageEvent);
    await Promise.resolve();
    ws.onmessage?.({ data: JSON.stringify({ id: 'one', token: 'A2' }) } as MessageEvent);
    await Promise.resolve();

    const firstChunkA = await firstReader.read();
    const firstChunkB = await firstReader.read();
    expect(decoder.decode(firstChunkA.value)).toBe(`data: ${JSON.stringify({ id: 'one', token: 'A1' })}\n\n`);
    expect(decoder.decode(firstChunkB.value)).toBe(`data: ${JSON.stringify({ id: 'one', token: 'A2' })}\n\n`);

    const secondChunk = await secondReader.read();
    expect(decoder.decode(secondChunk.value)).toBe(`data: ${JSON.stringify({ id: 'two', token: 'B1' })}\n\n`);

    // Frame whose correlation id matches no active stream is silently dropped.
    ws.onmessage?.({ data: JSON.stringify({ id: 'orphan', token: 'X' }) } as MessageEvent);
    await Promise.resolve();

    // A null-id frame falls through to the broadcast — both streams see it.
    ws.onmessage?.({ data: 'unrelated push' } as MessageEvent);
    const firstBroadcast = await firstReader.read();
    const secondBroadcast = await secondReader.read();
    expect(decoder.decode(firstBroadcast.value)).toBe('data: unrelated push\n\n');
    expect(decoder.decode(secondBroadcast.value)).toBe('data: unrelated push\n\n');

    await firstReader.cancel();
    await secondReader.cancel();
  });

  it('falls back to broadcasting when a correlate callback throws', async () => {
    const transport = createWebSocketTransport('wss://api.example.com/chat', {
      persistent: true,
      formatMessage: (text) => ({ payload: text, correlationId: text }),
      correlate: () => { throw new Error('boom'); },
    });

    const firstPromise = transport('one', [], new AbortController().signal);
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    const firstResponse = await firstPromise;
    const firstReader = firstResponse.body!.getReader();

    const secondResponse = await transport('two', [], new AbortController().signal);
    const secondReader = secondResponse.body!.getReader();

    ws.onmessage?.({ data: 'shared' } as MessageEvent);

    const decoder = new TextDecoder();
    expect(decoder.decode((await firstReader.read()).value)).toBe('data: shared\n\n');
    expect(decoder.decode((await secondReader.read()).value)).toBe('data: shared\n\n');
  });
});
