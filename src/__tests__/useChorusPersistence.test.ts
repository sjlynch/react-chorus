import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChorusPersistence } from '../hooks/useChorusPersistence';
import type { Message, StorageAdapter } from '../types';

const MSG: Message = { id: '1', role: 'user', text: 'hello' };
const MSGS: Message[] = [MSG, { id: '2', role: 'assistant', text: 'world' }];

function makeSyncStorage(initial?: string): StorageAdapter & { store: Record<string, string> } {
  const store: Record<string, string> = initial !== undefined ? { key: initial } : {};
  return {
    store,
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = v; },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------

describe('useChorusPersistence', () => {
  it('returns empty array when key is empty string', () => {
    const { result } = renderHook(() => useChorusPersistence(''));
    expect(result.current.value).toEqual([]);
  });

  it('returns empty array when storage is null (SSR)', () => {
    const { result } = renderHook(() =>
      useChorusPersistence('key', { storage: null as unknown as StorageAdapter })
    );
    expect(result.current.value).toEqual([]);
  });

  it('falls back safely when the default localStorage getter throws', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const originalLocalStorage = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Blocked', 'SecurityError'); },
    });

    try {
      const { result } = renderHook(() => useChorusPersistence('key'));
      expect(result.current.value).toEqual([]);
      expect(result.current.canPersist).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
      else Object.defineProperty(window, 'localStorage', { configurable: true, value: originalLocalStorage });
    }
  });

  it('reads initial value from synchronous storage', () => {
    const storage = makeSyncStorage(JSON.stringify(MSGS));
    const { result } = renderHook(() => useChorusPersistence('key', { storage }));
    expect(result.current.value).toEqual(MSGS);
  });

  it('reads initial value from default localStorage', () => {
    window.localStorage.setItem('chorus-default-key', JSON.stringify(MSGS));
    try {
      const { result } = renderHook(() => useChorusPersistence('chorus-default-key'));
      expect(result.current.value).toEqual(MSGS);
    } finally {
      window.localStorage.removeItem('chorus-default-key');
    }
  });

  it('reloads stored messages when the persistence key changes', () => {
    const storage = makeSyncStorage();
    storage.store.a = JSON.stringify([MSG]);
    storage.store.b = JSON.stringify(MSGS);

    const { result, rerender } = renderHook(
      ({ persistenceKey }) => useChorusPersistence(persistenceKey, { storage }),
      { initialProps: { persistenceKey: 'a' } },
    );

    expect(result.current.value).toEqual([MSG]);

    rerender({ persistenceKey: 'b' });

    expect(result.current.value).toEqual(MSGS);
  });

  it('returns empty array when stored value is invalid JSON', () => {
    const storage = makeSyncStorage('not json {{');
    const { result } = renderHook(() => useChorusPersistence('key', { storage }));
    expect(result.current.value).toEqual([]);
  });

  it('returns empty array when storage has no value for the key', () => {
    const storage = makeSyncStorage();
    const { result } = renderHook(() => useChorusPersistence('key', { storage }));
    expect(result.current.value).toEqual([]);
  });

  it('onChange updates local state', () => {
    const storage = makeSyncStorage();
    const { result } = renderHook(() => useChorusPersistence('key', { storage }));

    act(() => result.current.onChange(MSGS));

    expect(result.current.value).toEqual(MSGS);
  });

  it('onChange writes serialized messages to storage', () => {
    const storage = makeSyncStorage();
    const { result } = renderHook(() => useChorusPersistence('key', { storage }));

    act(() => result.current.onChange(MSGS));

    expect(storage.store['key']).toBe(JSON.stringify(MSGS));
  });

  it('onChange is stable across re-renders', () => {
    const storage = makeSyncStorage();
    const { result, rerender } = renderHook(() => useChorusPersistence('key', { storage }));
    const first = result.current.onChange;
    rerender();
    expect(result.current.onChange).toBe(first);
  });

  it('onChange is a no-op when storage is null', () => {
    const { result } = renderHook(() =>
      useChorusPersistence('key', { storage: null as unknown as StorageAdapter })
    );
    expect(() => act(() => result.current.onChange(MSGS))).not.toThrow();
  });

  it('loads initial value from async storage adapter via useEffect', async () => {
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn().mockResolvedValue(JSON.stringify([MSG])),
      setItem: vi.fn(),
    };

    const { result } = renderHook(() => useChorusPersistence('key', { storage: asyncStorage }));

    // Initial state before effect resolves
    expect(result.current.value).toEqual([]);

    // Wait for the async effect to settle
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.value).toEqual([MSG]);
  });

  it('silently handles rejected async storage on read', async () => {
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn().mockRejectedValue(new Error('storage unavailable')),
      setItem: vi.fn(),
    };

    const { result } = renderHook(() => useChorusPersistence('key', { storage: asyncStorage }));

    await act(async () => { await Promise.resolve(); });

    expect(result.current.value).toEqual([]);
  });

  it('ignores stale async reads after onChange writes newer messages', async () => {
    const pendingRead = deferred<string | null>();
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn(() => pendingRead.promise),
      setItem: vi.fn(),
    };

    const { result } = renderHook(() => useChorusPersistence('key', { storage: asyncStorage }));

    act(() => result.current.onChange([MSG]));
    expect(result.current.value).toEqual([MSG]);

    await act(async () => {
      pendingRead.resolve(JSON.stringify(MSGS));
      await pendingRead.promise;
    });

    expect(result.current.value).toEqual([MSG]);
  });

  it('records and surfaces synchronous write failures without throwing', async () => {
    const quotaError = new DOMException('Full', 'QuotaExceededError');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onError = vi.fn();
    const storage: StorageAdapter = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw quotaError; }),
    };

    const { result } = renderHook(() => useChorusPersistence('key', { storage, onError }));

    expect(() => act(() => result.current.onChange(MSGS))).not.toThrow();

    await act(async () => { await Promise.resolve(); });

    expect(result.current.error).toBe(quotaError);
    expect(onError).toHaveBeenCalledWith(quotaError);
    expect(warn).toHaveBeenCalledWith('[Chorus] Failed to persist messages.', quotaError);
    warn.mockRestore();
  });

  it('records and surfaces write failures when process is unavailable', async () => {
    const originalProcess = globalThis.process;
    const processWithoutEnv = Object.create(originalProcess ?? null) as typeof process;
    Object.defineProperty(processWithoutEnv, 'env', { value: undefined, configurable: true, writable: true });
    const quotaError = new DOMException('Full', 'QuotaExceededError');
    const onError = vi.fn();
    const storage: StorageAdapter = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw quotaError; }),
    };

    Object.defineProperty(globalThis, 'process', { value: processWithoutEnv, configurable: true, writable: true });
    try {
      const { result } = renderHook(() => useChorusPersistence('key', { storage, onError }));

      expect(() => act(() => result.current.onChange(MSGS))).not.toThrow();
      await act(async () => { await Promise.resolve(); });

      expect(result.current.error).toBe(quotaError);
      expect(onError).toHaveBeenCalledWith(quotaError);
    } finally {
      Object.defineProperty(globalThis, 'process', { value: originalProcess, configurable: true, writable: true });
    }
  });

  it('records and surfaces rejected async write failures without throwing', async () => {
    const writeError = new Error('write failed');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onError = vi.fn();
    const storage: StorageAdapter = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => Promise.reject(writeError)),
    };

    const { result } = renderHook(() => useChorusPersistence('key', { storage, onError }));

    expect(() => act(() => result.current.onChange(MSGS))).not.toThrow();

    await act(async () => { await Promise.resolve(); });

    expect(result.current.error).toBe(writeError);
    expect(onError).toHaveBeenCalledWith(writeError);
    expect(warn).toHaveBeenCalledWith('[Chorus] Failed to persist messages.', writeError);
    warn.mockRestore();
  });

  it('serializes async writes so newer messages win', async () => {
    const store: Record<string, string> = {};
    const writes: Array<{ value: string; resolve: () => void }> = [];
    const storage: StorageAdapter = {
      getItem: vi.fn(() => null),
      setItem: vi.fn((_key, value) => new Promise<void>((resolve) => {
        writes.push({
          value,
          resolve: () => {
            store.key = value;
            resolve();
          },
        });
      })),
    };

    const { result } = renderHook(() => useChorusPersistence('key', { storage }));

    act(() => result.current.onChange([MSG]));
    act(() => result.current.onChange(MSGS));

    expect(writes).toHaveLength(1);
    expect(writes[0].value).toBe(JSON.stringify([MSG]));

    await act(async () => {
      writes[0].resolve();
      await Promise.resolve();
    });

    expect(writes).toHaveLength(2);
    expect(writes[1].value).toBe(JSON.stringify(MSGS));

    await act(async () => {
      writes[1].resolve();
      await Promise.resolve();
    });

    expect(store.key).toBe(JSON.stringify(MSGS));
  });
});
