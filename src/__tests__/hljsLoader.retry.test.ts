import { describe, expect, it } from 'vitest';
import { createRetryableLazyImport } from '../utils/hljsLoader';

describe('createRetryableLazyImport', () => {
  it('clears a rejected lazy import promise so a later call retries', async () => {
    let attempts = 0;
    const load = createRetryableLazyImport(() => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('transient chunk failure'));
      return Promise.resolve('loaded');
    });

    await expect(load()).rejects.toThrow('transient chunk failure');
    await expect(load()).resolves.toBe('loaded');
    expect(attempts).toBe(2);
  });

  it('shares an in-flight successful lazy import promise', async () => {
    let attempts = 0;
    const load = createRetryableLazyImport(async () => {
      attempts += 1;
      return 'loaded';
    });

    const first = load();
    const second = load();

    await expect(first).resolves.toBe('loaded');
    await expect(second).resolves.toBe('loaded');
    expect(first).toBe(second);
    expect(attempts).toBe(1);
  });
});
