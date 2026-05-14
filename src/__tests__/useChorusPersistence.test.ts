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

  it('flushes a pending write for the old key before a new key can overwrite it', async () => {
    vi.useFakeTimers();
    try {
      const storage = makeSyncStorage();
      const { result, rerender } = renderHook(
        ({ persistenceKey }) => useChorusPersistence(persistenceKey, { storage, writeDebounceMs: 1000 }),
        { initialProps: { persistenceKey: 'a' } },
      );

      act(() => result.current.onChange([MSG]));
      expect(storage.store.a).toBeUndefined();

      rerender({ persistenceKey: 'b' });
      act(() => result.current.onChange(MSGS));

      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(storage.store.a).toBe(JSON.stringify([MSG]));
      expect(storage.store.b).toBe(JSON.stringify(MSGS));
    } finally {
      vi.useRealTimers();
    }
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

  it('removes the key for an empty flush when the adapter supports removeItem', () => {
    const storage = makeSyncStorage(JSON.stringify(MSGS));
    storage.removeItem = vi.fn((key) => { delete storage.store[key]; });
    const { result } = renderHook(() => useChorusPersistence('key', { storage }));

    act(() => result.current.onChange([], { flush: true, removeIfEmpty: true }));

    expect(storage.removeItem).toHaveBeenCalledWith('key');
    expect(storage.store.key).toBeUndefined();
  });

  it('falls back to writing [] for an empty flush when removeItem is unavailable', () => {
    const storage = makeSyncStorage(JSON.stringify(MSGS));
    const { result } = renderHook(() => useChorusPersistence('key', { storage }));

    act(() => result.current.onChange([], { flush: true, removeIfEmpty: true }));

    expect(storage.store.key).toBe(JSON.stringify([]));
  });

  it('flushes a debounced write on pagehide', () => {
    vi.useFakeTimers();
    try {
      const storage = makeSyncStorage();
      storage.setItem = vi.fn((key, value) => { storage.store[key] = value; });
      const { result } = renderHook(() => useChorusPersistence('key', { storage, writeDebounceMs: 1000 }));

      act(() => result.current.onChange(MSGS));
      expect(storage.setItem).not.toHaveBeenCalled();

      act(() => { window.dispatchEvent(new Event('pagehide')); });

      expect(storage.setItem).toHaveBeenCalledWith('key', JSON.stringify(MSGS));
    } finally {
      vi.useRealTimers();
    }
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

  it('uses custom serializer and deserializer hooks', () => {
    const storage = makeSyncStorage('custom:read');
    const serializeMessages = vi.fn(() => 'custom:write');
    const deserializeMessages = vi.fn(() => [MSG]);
    const { result } = renderHook(() => useChorusPersistence('key', { storage, serializeMessages, deserializeMessages }));

    expect(result.current.value).toEqual([MSG]);

    act(() => result.current.onChange(MSGS));

    expect(deserializeMessages).toHaveBeenCalledWith('custom:read');
    expect(serializeMessages).toHaveBeenCalledWith(MSGS);
    expect(storage.store.key).toBe('custom:write');
  });

  it('restores Date metadata as strings with the default JSON deserializer', () => {
    const timestamp = new Date('2026-05-14T00:00:00.000Z');
    const storage = makeSyncStorage(JSON.stringify([{ ...MSG, metadata: { timestamp } }]));
    const { result } = renderHook(() => useChorusPersistence<{ timestamp: Date }>('key', { storage }));

    expect(result.current.value[0].metadata?.timestamp).toBe('2026-05-14T00:00:00.000Z');
  });

  it('can revive Date metadata with a custom deserializer', () => {
    const timestamp = '2026-05-14T00:00:00.000Z';
    const storage = makeSyncStorage(JSON.stringify([{ ...MSG, metadata: { timestamp } }]));
    const { result } = renderHook(() => useChorusPersistence<{ timestamp: Date }>('key', {
      storage,
      deserializeMessages: (raw) => JSON.parse(raw, (field, value) => (
        field === 'timestamp' && typeof value === 'string' ? new Date(value) : value
      )) as Message<{ timestamp: Date }>[],
    }));

    expect(result.current.value[0].metadata?.timestamp).toBeInstanceOf(Date);
  });

  it('surfaces BigInt serialization failures through the persistence error path', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onError = vi.fn();
    const storage = makeSyncStorage();
    const { result } = renderHook(() => useChorusPersistence<{ count: bigint }>('key', { storage, onError }));
    const message: Message<{ count: bigint }> = { id: 'big', role: 'user', text: 'big', metadata: { count: 1n } };

    act(() => result.current.onChange([message]));

    expect(result.current.error).toBeInstanceOf(TypeError);
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError));
    expect(storage.store.key).toBeUndefined();
    warn.mockRestore();
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
