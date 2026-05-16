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

  // Vercel AI SDK UI message stream error frames use { type: 'error', errorText: '...' }.
  if (value.type === 'error' && typeof value.errorText === 'string' && value.errorText) {
    return value.errorText;
  }

  return null;
}
