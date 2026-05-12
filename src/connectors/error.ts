export function extractErrorMessage(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;

  const value = obj as Record<string, unknown>;
  const error = value.error;

  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message) return message;
  }

  if (value.type === 'error' && typeof value.message === 'string' && value.message) {
    return value.message;
  }

  return null;
}
