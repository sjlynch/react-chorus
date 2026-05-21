import { vi } from 'vitest';

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function makeResponse(body = 'data: hello\n\n'): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream);
}

export function makeSseResponse(tokens: string[]): Response {
  return makeResponse(tokens.map(token => `data: ${token}\n\n`).join(''));
}

export function makeOpenSseResponse(tokens: string[], onCancel?: () => void): Response {
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

export function makeControlledSseResponse() {
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

export class MockWebSocket {
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

export function makeAbortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError') as Error;
}

export function resetUseChorusStreamTestEnv() {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  MockWebSocket.instances = [];
}
