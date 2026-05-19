// Streaming-only leaf module: `useChorusStream` and `delayedStreamEvents` are
// already bundled in the same chunk (the hook imports the emitter directly),
// so they can share these tiny helpers here without pulling utils-owned
// chunks into the streaming bundle. The transport-only websocket subpath has
// its own copies under `streaming/websocket/shared.ts` to keep that subpath
// budget separate — see `src/streaming/websocket/CLAUDE.md`.

export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) return error as Error;
  return new Error(String(error));
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name?: unknown }).name === 'AbortError';
}

export function createAbortError(message = 'Aborted'): Error {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError') as Error;
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}
