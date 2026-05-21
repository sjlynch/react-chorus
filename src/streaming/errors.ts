const MAX_ERROR_BODY_CHARS = 2048;
const ERROR_BODY_READ_TIMEOUT_MS = 2000;

export interface ErrorBodySnippet {
  text: string;
  truncated: boolean;
  timedOut: boolean;
}

export type ChorusStreamErrorCode = 'concurrent-send' | 'already-aborted';

export class ChorusStreamError extends Error {
  errorPayload?: unknown;
  code?: ChorusStreamErrorCode;
  override cause?: unknown;

  constructor(message: string, options: { errorPayload?: unknown; cause?: unknown; code?: ChorusStreamErrorCode } = {}) {
    super(message);
    this.name = 'ChorusStreamError';
    if (Object.prototype.hasOwnProperty.call(options, 'errorPayload')) this.errorPayload = options.errorPayload;
    if (Object.prototype.hasOwnProperty.call(options, 'cause')) this.cause = options.cause;
    if (Object.prototype.hasOwnProperty.call(options, 'code')) this.code = options.code;
  }
}

/**
 * Slice `text` to at most `maxChars` UTF-16 code units without leaving a lone
 * surrogate at the boundary. If the last kept unit is a high surrogate, its
 * low surrogate sits just past the cut, so drop the high surrogate too — that
 * keeps the diagnostic snippet free of invalid characters.
 */
function sliceOnCodePointBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const lastUnit = text.charCodeAt(maxChars - 1);
  const isHighSurrogate = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  return text.slice(0, isHighSurrogate ? maxChars - 1 : maxChars);
}

export async function readErrorBodySnippet(
  res: Response,
  maxChars = MAX_ERROR_BODY_CHARS,
  timeoutMs = ERROR_BODY_READ_TIMEOUT_MS,
): Promise<ErrorBodySnippet> {
  const clone = res.clone();
  if (!clone.body) return { text: '', truncated: false, timedOut: false };

  const reader = clone.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let truncated = false;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const deadline = Date.now() + timeoutMs;

  const readWithTimeout = () => new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const remaining = Math.max(0, deadline - Date.now());
    timeout = setTimeout(() => {
      timedOut = true;
      reject(new Error('Timed out reading error response body'));
    }, remaining);

    reader.read().then(resolve, reject).finally(() => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
    });
  });

  try {
    while (text.length < maxChars) {
      const { value, done } = await readWithTimeout();
      if (done) break;

      text += decoder.decode(value, { stream: true });
      if (text.length >= maxChars) {
        truncated = true;
        break;
      }
    }
  } catch {
    truncated = truncated || timedOut;
  } finally {
    reader.cancel().catch(() => undefined);
    if (timeout !== null) clearTimeout(timeout);
  }

  // Flush any bytes the streaming decoder buffered at the final chunk boundary
  // — the loop can `break` mid-sequence on truncation, so this is not reached
  // only on the `done` path — then bound the snippet on a code-point boundary.
  text += decoder.decode();
  return { text: sliceOnCodePointBoundary(text, maxChars), truncated, timedOut };
}

/**
 * True for a {@link ChorusStreamError} that rejected a send before it ever
 * started — a `concurrent-send` overlap (a previous send still in flight) or an
 * `already-aborted` externalSignal. These reject `send()` without invoking the
 * transport or firing `cb.onError`, so any caller that attaches a bare `.catch`
 * to the send promise must detect them here and surface the error itself rather
 * than swallow the turn.
 */
export function isUnstartedSendError(error: unknown): error is ChorusStreamError {
  return error instanceof ChorusStreamError
    && (error.code === 'concurrent-send' || error.code === 'already-aborted');
}

export async function createHttpResponseError(res: Response) {
  const statusText = res.statusText ? ` ${res.statusText}` : '';
  const { text, truncated, timedOut } = await readErrorBodySnippet(res);
  const detail = text.trim();
  const timeoutSuffix = timedOut ? ' (error body unavailable: read timed out)' : '';
  const bodyDetail = detail ? `: ${detail}${truncated && !timedOut ? '…' : ''}${timeoutSuffix}` : timeoutSuffix;
  return new ChorusStreamError(`HTTP ${res.status}${statusText}${bodyDetail}`);
}

export function createConnectorStreamError(message: string, errorPayload?: unknown): ChorusStreamError {
  return new ChorusStreamError(message, { errorPayload, cause: errorPayload });
}

