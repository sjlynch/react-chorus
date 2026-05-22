import { afterEach, describe, expect, it, vi } from 'vitest';

const realCrypto = globalThis.crypto;

describe('createRandomId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('delegates to crypto.randomUUID when available and keeps the prefix', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'stub-uuid' });
    vi.resetModules();
    const { createRandomId } = await import('../utils/ids');
    // The UUID path must still apply the prefix so ids are shaped consistently
    // with the WebCrypto-less fallback path (`${prefix}-...`).
    expect(createRandomId('m')).toBe('m-stub-uuid');
  });

  it('fallback produces no duplicates across sibling realms in the same millisecond', async () => {
    // No randomUUID -> force the counter fallback path. getRandomValues stays
    // available so each realm seeds a distinct per-process nonce.
    vi.stubGlobal('crypto', {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    });
    // Pin the clock so both realms collide on Date.now() — the exact scenario
    // (two tabs opened in the same millisecond) the nonce has to survive.
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    vi.resetModules();
    const realmA = (await import('../utils/ids')).createRandomId;
    vi.resetModules();
    const realmB = (await import('../utils/ids')).createRandomId;

    const idsA = Array.from({ length: 1000 }, () => realmA('m'));
    const idsB = Array.from({ length: 1000 }, () => realmB('m'));

    // Sanity: the counter fallback was actually exercised, not randomUUID.
    expect(idsA[0]).toMatch(/^m-/);

    const all = [...idsA, ...idsB];
    expect(new Set(all).size).toBe(all.length);
  });

  it('falls back to Math.random entropy when WebCrypto is absent entirely', async () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    vi.resetModules();
    const realmA = (await import('../utils/ids')).createRandomId;
    vi.resetModules();
    const realmB = (await import('../utils/ids')).createRandomId;

    const all = [
      ...Array.from({ length: 1000 }, () => realmA('m')),
      ...Array.from({ length: 1000 }, () => realmB('m')),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps counters independent per prefix', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    });
    vi.resetModules();
    const { createRandomId } = await import('../utils/ids');

    const first = createRandomId('a');
    const second = createRandomId('b');
    expect(first).toMatch(/-1$/);
    expect(second).toMatch(/-1$/);
    expect(first).not.toBe(second);
  });
});
