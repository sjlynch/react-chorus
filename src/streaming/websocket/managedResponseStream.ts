import { toError } from './shared';

export type ManagedResponseStream = {
  readonly body: ReadableStream<Uint8Array>;
  readonly closed: () => boolean;
  readonly enqueue: (chunk: Uint8Array) => void;
  readonly close: () => void;
  readonly error: (error: unknown) => void;
  readonly setCleanup: (fn: () => void) => void;
};

export function createManagedResponseStream(onCancel: () => void): ManagedResponseStream {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let streamClosed = false;
  let cleanup = () => {};

  const close = () => {
    if (streamClosed) return;
    streamClosed = true;
    cleanup();
    try { controller?.close(); } catch {}
  };

  const error = (err: unknown) => {
    if (streamClosed) return;
    streamClosed = true;
    cleanup();
    try { controller?.error(toError(err)); } catch {}
  };

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      if (!streamClosed) {
        streamClosed = true;
        cleanup();
      }
      onCancel();
    },
  });

  return {
    body,
    closed: () => streamClosed,
    enqueue: (chunk: Uint8Array) => {
      if (streamClosed) return;
      try { controller?.enqueue(chunk); } catch {}
    },
    close,
    error,
    setCleanup: (fn: () => void) => {
      cleanup = fn;
    },
  };
}
