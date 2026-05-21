export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) return error as Error;
  return new Error(String(error));
}

/**
 * Builds a fresh Error to carry storage/persistence metadata, without ever
 * mutating the input. When `error` is already an Error or DOMException, the
 * returned Error copies its `message`/`name` and references the original
 * through `cause` — so a meaningful pre-existing `cause` survives, and a
 * shared or frozen DOMException (browsers may reuse a single
 * `QuotaExceededError` instance whose properties are read-only getters) is
 * never written to. Non-Error inputs are stringified, with the raw thrown
 * value kept as `cause`. The result is always a new instance, so callers can
 * safely attach `.key`/`.operation` without clobbering a shared error.
 */
export function wrapError(error: unknown): Error {
  const isError = error instanceof Error
    || (typeof DOMException !== 'undefined' && error instanceof DOMException);
  if (isError) {
    const source = error as Error;
    const wrapped = new Error(source.message);
    if (source.name) wrapped.name = source.name;
    wrapped.cause = source;
    return wrapped;
  }
  const wrapped = new Error(String(error));
  wrapped.cause = error;
  return wrapped;
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError';
}

export function createAbortError(message = 'Aborted'): Error {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError') as Error;
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}
