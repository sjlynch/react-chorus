import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSSEStream } from '../hooks/useChorusStream';
import { createWebSocketTransport } from '../streaming/createWebSocketTransport';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  protocols?: string | string[];
  sent: string[] = [];
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

  close() {}

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
});
