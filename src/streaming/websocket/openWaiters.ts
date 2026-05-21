import { createAbortError } from './shared';

type OpenWaiter = {
  resolve: (ws: WebSocket) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

export type OpenWaiterManager = {
  wait: (signal: AbortSignal) => Promise<WebSocket>;
  resolve: (ws: WebSocket) => void;
  reject: (error: Error) => void;
};

export function createOpenWaiterManager(): OpenWaiterManager {
  const waiters = new Set<OpenWaiter>();

  const remove = (waiter: OpenWaiter) => {
    waiters.delete(waiter);
    waiter.signal.removeEventListener('abort', waiter.onAbort);
  };

  const wait = (signal: AbortSignal) => new Promise<WebSocket>((resolve, reject) => {
    const waiter: OpenWaiter = {
      resolve,
      reject,
      signal,
      onAbort: () => {
        remove(waiter);
        reject(createAbortError());
      },
    };

    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    waiters.add(waiter);
    signal.addEventListener('abort', waiter.onAbort, { once: true });
  });

  const resolve = (ws: WebSocket) => {
    for (const waiter of Array.from(waiters)) {
      remove(waiter);
      waiter.resolve(ws);
    }
  };

  const reject = (error: Error) => {
    for (const waiter of Array.from(waiters)) {
      remove(waiter);
      waiter.reject(error);
    }
  };

  return { wait, resolve, reject };
}
