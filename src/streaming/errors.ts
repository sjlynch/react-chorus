const MAX_ERROR_BODY_CHARS = 2048;
const ERROR_BODY_READ_TIMEOUT_MS = 2000;

export interface ErrorBodySnippet {
  text: string;
  truncated: boolean;
  timedOut: boolean;
}

export type ChorusStreamErrorCode = 'concurrent-send';

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
      if (done) {
        text += decoder.decode();
        return { text, truncated, timedOut };
      }

      text += decoder.decode(value, { stream: true });
      if (text.length >= maxChars) {
        truncated = true;
        text = text.slice(0, maxChars);
        break;
      }
    }
  } catch {
    truncated = truncated || timedOut;
  } finally {
    reader.cancel().catch(() => undefined);
    if (timeout !== null) clearTimeout(timeout);
  }

  return { text, truncated, timedOut };
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

