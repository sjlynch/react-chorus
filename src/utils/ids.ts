const fallbackCounters = new Map<string, number>();

export function createRandomId(prefix: string): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);

  const next = (fallbackCounters.get(prefix) ?? 0) + 1;
  fallbackCounters.set(prefix, next);
  return `${prefix}-${Date.now()}-${next}`;
}
