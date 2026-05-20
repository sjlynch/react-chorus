// These tiny helpers stay local to the transport chunk so the transport-only
// subpath never imports UI/hook chunks through shared utilities.
export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

export function createAbortError(message = 'Aborted'): Error {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError') as Error;
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function encodeSSEDataEvent(data: string) {
  return `${data.split(/\r\n|\r|\n/).map(line => `data: ${line}`).join('\n')}\n\n`;
}

export function createClosedBeforeOpenError(event: CloseEvent) {
  const reason = event.reason ? `: ${event.reason}` : '';
  return new Error(`WebSocket closed before opening (code ${event.code}${reason})`);
}

// 1000 Normal Closure is the only code that signals a clean end-of-stream from
// the server. Everything else (1001 going away, 1006 abnormal closure, 1011
// server error, etc.) means the socket dropped before the provider sent its
// done sentinel and any active response stream should be errored, not closed,
// so callers and telemetry can distinguish truncation from completion.
export function isNormalCloseCode(code: number): boolean {
  return code === 1000;
}

export function createAbnormalCloseError(event: CloseEvent) {
  const reason = event.reason ? `: ${event.reason}` : '';
  return new Error(`WebSocket closed before stream complete (code ${event.code}${reason})`);
}

// A client-initiated `transport.close()` is *not* a clean end-of-stream: unlike
// a server close, the response was still streaming when the caller tore the
// socket down. The socket closes with code 1000 (normal closure) by default, so
// `isNormalCloseCode` cannot tell it apart from a real server EOF — `close()`
// instead surfaces this explicit error to every in-flight response stream so a
// reader mid-stream rejects rather than seeing a silent `done` (a truncated
// assistant message).
export function createTransportClosedError(code?: number, reason?: string) {
  let detail = '';
  if (code !== undefined) detail = reason ? ` (code ${code}: ${reason})` : ` (code ${code})`;
  return new Error(`WebSocket transport closed by client before the stream completed${detail}`);
}

export function safeCloseSocket(ws: WebSocket, code?: number, reason?: string) {
  try {
    if (code === undefined) ws.close();
    else ws.close(code, reason);
  } catch {}
}

function isArrayBufferLike(data: unknown): data is ArrayBuffer {
  return typeof data === 'object' && data !== null && typeof (data as ArrayBuffer).byteLength === 'number' && typeof (data as ArrayBuffer).slice === 'function';
}

export function normalizeFormatMessageResult(
  result: string | { payload: string; correlationId?: string | null },
): { payload: string; correlationId: string | null } {
  if (typeof result === 'string') return { payload: result, correlationId: null };
  return { payload: result.payload, correlationId: result.correlationId ?? null };
}

export async function webSocketMessageToText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (isArrayBufferLike(data)) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  throw new Error('WebSocket message data must be a string, Blob, ArrayBuffer, or typed array');
}
