export const COPY_FEEDBACK_DURATION_MS = 1200;
export const COPY_FAILED_LABEL = 'Copy failed';

type ClipboardCopyErrorHandler = (error: Error) => void;

const CLIPBOARD_COPY_FAILED_MESSAGE = 'Clipboard copy failed';
const CLIPBOARD_UNAVAILABLE_MESSAGE = 'Clipboard API is unavailable';

export function toClipboardError(error: unknown, fallbackMessage = CLIPBOARD_COPY_FAILED_MESSAGE) {
  if (error instanceof Error) return error;

  if (typeof error === 'string' && error.trim()) return new Error(error);

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return new Error(message);
  }

  return new Error(fallbackMessage);
}

export function canWriteTextToClipboard() {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
}

export async function writeTextToClipboard(text: string, onError?: ClipboardCopyErrorHandler) {
  if (!canWriteTextToClipboard()) {
    const error = new Error(CLIPBOARD_UNAVAILABLE_MESSAGE);
    onError?.(error);
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    onError?.(toClipboardError(error));
    return false;
  }
}
