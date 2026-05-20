const fallbackCounters = new Map<string, number>();

/**
 * Build a per-process random nonce. Two realms (separate tabs, iframes, SSR
 * workers, or test runs) each compute their own, so the counter fallback below
 * cannot collide even when both realms start a counter at 1 in the same
 * millisecond. Seeded from `crypto.getRandomValues` when available, otherwise
 * from `Math.random` for runtimes with no WebCrypto at all.
 */
function createProcessNonce(): string {
  const getRandomValues = globalThis.crypto?.getRandomValues;
  if (typeof getRandomValues === 'function') {
    const bytes = getRandomValues.call(globalThis.crypto, new Uint8Array(8));
    let nonce = '';
    for (const byte of bytes) nonce += byte.toString(16).padStart(2, '0');
    return nonce;
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

const processNonce = createProcessNonce();

export function createRandomId(prefix: string): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);

  const next = (fallbackCounters.get(prefix) ?? 0) + 1;
  fallbackCounters.set(prefix, next);
  return `${prefix}-${processNonce}-${Date.now()}-${next}`;
}
