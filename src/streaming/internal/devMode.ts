// Streaming/transport-side dev-mode leaf module, deliberately kept SEPARATE
// from `src/utils/devMode.ts`. The streaming hook chunk (`useChorusStream`) and
// the transport sub-bundles (`createFetchSSETransport`, `websocket/persistent`,
// `websocket/transient`) import `isStreamDevMode`/`warnInDev` from here so they
// never pull the utils-owned chunk into their graph and blow the tight
// bundle-size budgets tracked in the root README.
//
// `isStreamDevMode` is therefore an intentional one-line duplicate of
// `isChorusDevMode`. Do NOT "de-duplicate" it by importing from
// `src/utils/devMode.ts`: that would re-introduce the exact cross-chunk
// dependency this module exists to avoid. See `streamErrors.ts` for the same
// rationale.

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
