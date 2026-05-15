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
});
