import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
});
