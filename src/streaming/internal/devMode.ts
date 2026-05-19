// Streaming-only leaf module shared by `useChorusStream` and (transitively
// via the hook) any other streaming-chunk consumer. Kept here so the hook
// chunk does not need to import from `src/utils/devMode.ts` and pull in the
// utils-owned chunk — see `streamErrors.ts` for the same rationale.

export function isStreamDevMode(): boolean {
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

export function warnInDev(message: string, ...args: unknown[]): void {
  if (!isStreamDevMode()) return;
  console.warn(message, ...args);
}
