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

  it('surfaces invalid JSON through error and onError while returning an empty array', async () => {
    const onError = vi.fn();
    const storage = makeSyncStorage('not json {{');
    const { result } = renderHook(() => useChorusPersistence('key', { storage, onError }));

    expect(result.current.value).toEqual([]);
    expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'deserialize' }));
    await act(async () => { await Promise.resolve(); });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ key: 'key', operation: 'deserialize' }));
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

  it('flushes a debounced write through the immediate path on pagehide for async storage', () => {
    vi.useFakeTimers();
    try {
      const setItem = vi.fn().mockResolvedValue(undefined);
      const asyncStorage: StorageAdapter = {
        getItem: vi.fn().mockReturnValue(null),
        setItem,
      };
      const { result } = renderHook(() => useChorusPersistence('key', { storage: asyncStorage, writeDebounceMs: 1000 }));

      act(() => result.current.onChange(MSGS));
      expect(setItem).not.toHaveBeenCalled();

      act(() => { window.dispatchEvent(new Event('pagehide')); });

      expect(setItem).toHaveBeenCalledWith('key', JSON.stringify(MSGS));
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes a page-lifecycle flush through the write chain when a prior write is still settling', async () => {
    const storage = makeSyncStorage();
    const setItemArgs: string[] = [];
    storage.setItem = (k, v) => { storage.store[k] = v; setItemArgs.push(v); };
    const { result } = renderHook(() => useChorusPersistence('key', { storage, writeDebounceMs: 1000 }));

    await act(async () => {
      // Write A starts and stays in flight (its runQueuedWrite microtask is pending).
      result.current.onChange([MSG], { flush: true });
      // Write B is debounced, then a pagehide flush takes it while A is still settling.
      result.current.onChange(MSGS);
      window.dispatchEvent(new Event('pagehide'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // B is chained after A rather than orphaning it — both land, in order.
    expect(setItemArgs).toEqual([JSON.stringify([MSG]), JSON.stringify(MSGS)]);
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

  it('surfaces rejected async storage reads through error and onError', async () => {
    const readError = new Error('storage unavailable');
    const onError = vi.fn();
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn().mockRejectedValue(readError),
      setItem: vi.fn(),
    };

    const { result } = renderHook(() => useChorusPersistence('key', { storage: asyncStorage, onError }));

    await act(async () => { await Promise.resolve(); });

    expect(result.current.value).toEqual([]);
    expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'read' }));
    expect(result.current.error?.cause).toBe(readError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ key: 'key', operation: 'read' }));
  });

  it('lets pending async reads win over pre-load changes so existing storage is not clobbered', async () => {
    const pendingRead = deferred<string | null>();
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn(() => pendingRead.promise),
      setItem: vi.fn(),
    };

    const { result } = renderHook(() => useChorusPersistence('key', { storage: asyncStorage }));

    expect(result.current.loaded).toBe(false);
    act(() => result.current.onChange([MSG]));

    expect(result.current.value).toEqual([]);
    expect(asyncStorage.setItem).not.toHaveBeenCalled();

    await act(async () => {
      pendingRead.resolve(JSON.stringify(MSGS));
      await pendingRead.promise;
    });

    expect(result.current.value).toEqual(MSGS);
    expect(asyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('replays the latest pre-load change after an async read confirms storage is empty', async () => {
    const pendingRead = deferred<string | null>();
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn(() => pendingRead.promise),
      setItem: vi.fn(),
    };

    const { result } = renderHook(() => useChorusPersistence('key', { storage: asyncStorage }));

    act(() => result.current.onChange([MSG]));
    act(() => result.current.onChange(MSGS));
    expect(asyncStorage.setItem).not.toHaveBeenCalled();

    await act(async () => {
      pendingRead.resolve(null);
      await pendingRead.promise;
    });

    expect(result.current.value).toEqual(MSGS);
    expect(asyncStorage.setItem).toHaveBeenCalledWith('key', JSON.stringify(MSGS));
  });

  it('surfaces throwing custom deserializers through error and onError', async () => {
    const deserializeError = new Error('bad payload');
    const onError = vi.fn();
    const storage = makeSyncStorage('custom:bad');
    const { result } = renderHook(() => useChorusPersistence('key', {
      storage,
      onError,
      deserializeMessages: () => { throw deserializeError; },
    }));

    expect(result.current.value).toEqual([]);
    expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'deserialize' }));
    expect(result.current.error?.cause).toBe(deserializeError);
    await act(async () => { await Promise.resolve(); });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ key: 'key', operation: 'deserialize' }));
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

    expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'write' }));
    expect(result.current.error?.cause).toBeInstanceOf(TypeError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ key: 'key', operation: 'write' }));
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

    expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'write' }));
    expect(result.current.error?.cause).toBe(quotaError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ key: 'key', operation: 'write' }));
    expect(warn).toHaveBeenCalledWith('[Chorus] Failed to persist messages.', expect.objectContaining({ key: 'key', operation: 'write' }));
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

      expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'write' }));
      expect(result.current.error?.cause).toBe(quotaError);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ key: 'key', operation: 'write' }));
    } finally {
      Object.defineProperty(globalThis, 'process', { value: originalProcess, configurable: true, writable: true });
    }
  });

  it('records and surfaces removeItem failures with remove context', async () => {
    const removeError = new Error('remove failed');
    const onError = vi.fn();
    const storage = makeSyncStorage(JSON.stringify(MSGS));
    storage.removeItem = vi.fn(() => { throw removeError; });
    const { result } = renderHook(() => useChorusPersistence('key', { storage, onError }));

    act(() => result.current.onChange([], { flush: true, removeIfEmpty: true }));

    expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'remove' }));
    expect(result.current.error?.cause).toBe(removeError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ key: 'key', operation: 'remove' }));
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

    expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'write' }));
    expect(result.current.error?.cause).toBe(writeError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ key: 'key', operation: 'write' }));
    expect(warn).toHaveBeenCalledWith('[Chorus] Failed to persist messages.', expect.objectContaining({ key: 'key', operation: 'write' }));
    warn.mockRestore();
  });

  it('wraps a foreign adapter error that happens to carry key/operation fields', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A remote StorageAdapter rejects with its own error shape. It is NOT a
    // Chorus error even though it duck-types `key`/`operation`, so it must be
    // wrapped with the real Chorus key/operation rather than passed through.
    const foreignError = Object.assign(new Error('remote backend unavailable'), {
      key: 'remote/transcripts/key',
      operation: 'remote-write',
    });
    const onError = vi.fn();
    const storage: StorageAdapter = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => Promise.reject(foreignError)),
    };

    const { result } = renderHook(() => useChorusPersistence('key', { storage, onError }));

    act(() => result.current.onChange([MSG]));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'write' }));
    expect(result.current.error?.cause).toBe(foreignError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ key: 'key', operation: 'write' }));
    warn.mockRestore();
  });

  describe('cross-tab sync', () => {
    function dispatchStorageEvent(key: string, newValue: string | null) {
      window.dispatchEvent(new StorageEvent('storage', {
        key,
        newValue,
        oldValue: null,
        storageArea: window.localStorage,
      }));
    }

    it('picks up writes from another tab via the storage event', () => {
      const key = 'chorus-cross-tab-pickup';
      try {
        const { result } = renderHook(() => useChorusPersistence(key));
        expect(result.current.value).toEqual([]);

        const payload = JSON.stringify(MSGS);
        window.localStorage.setItem(key, payload);
        act(() => dispatchStorageEvent(key, payload));

        expect(result.current.value).toEqual(MSGS);
        expect(result.current.hasStoredValue).toBe(true);
      } finally {
        window.localStorage.removeItem(key);
      }
    });

    it('lets a subsequent write merge with another tab\'s changes rather than stomping them', () => {
      const key = 'chorus-cross-tab-stomp';
      try {
        const tabAMessage: Message = { id: 'a', role: 'user', text: 'from tab A' };
        const tabBMessage: Message = { id: 'b', role: 'user', text: 'from tab B' };

        const { result } = renderHook(() => useChorusPersistence(key));

        const tabAPayload = JSON.stringify([tabAMessage]);
        window.localStorage.setItem(key, tabAPayload);
        act(() => dispatchStorageEvent(key, tabAPayload));
        expect(result.current.value).toEqual([tabAMessage]);

        const merged = [...result.current.value, tabBMessage];
        act(() => result.current.onChange(merged));

        expect(JSON.parse(window.localStorage.getItem(key) ?? '[]')).toEqual(merged);
      } finally {
        window.localStorage.removeItem(key);
      }
    });

    it('clears in-memory state when another tab removes the key', () => {
      const key = 'chorus-cross-tab-clear';
      window.localStorage.setItem(key, JSON.stringify(MSGS));
      try {
        const { result } = renderHook(() => useChorusPersistence(key));
        expect(result.current.value).toEqual(MSGS);

        window.localStorage.removeItem(key);
        act(() => dispatchStorageEvent(key, null));

        expect(result.current.value).toEqual([]);
        expect(result.current.hasStoredValue).toBe(false);
      } finally {
        window.localStorage.removeItem(key);
      }
    });

    it('ignores storage events that mirror the current in-memory value (polyfill defense)', () => {
      const key = 'chorus-cross-tab-mirror';
      try {
        const { result } = renderHook(() => useChorusPersistence(key));
        act(() => result.current.onChange(MSGS));
        const previousValue = result.current.value;

        act(() => dispatchStorageEvent(key, JSON.stringify(MSGS)));

        expect(result.current.value).toBe(previousValue);
      } finally {
        window.localStorage.removeItem(key);
      }
    });

    it('queues a cross-tab storage event behind an in-flight local write (no lost update)', async () => {
      const key = 'chorus-cross-tab-inflight';
      const setItemGate = deferred<void>();
      let setItemCalls = 0;
      const asyncLocalStorage: StorageAdapter = {
        getItem: () => Promise.resolve(null),
        setItem: () => { setItemCalls += 1; return setItemGate.promise; },
      };
      const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
      const originalLocalStorage = window.localStorage;
      Object.defineProperty(window, 'localStorage', { configurable: true, value: asyncLocalStorage });

      try {
        const { result } = renderHook(() => useChorusPersistence(key));
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        // A local write starts and stays in flight (its setItem promise is gated).
        const localMsgs: Message[] = [{ id: 'local', role: 'user', text: 'local edit' }];
        act(() => result.current.onChange(localMsgs, { flush: true }));
        expect(result.current.value).toEqual(localMsgs);
        expect(setItemCalls).toBe(1);

        // An external tab event arrives mid-write — it must not clobber the
        // pending local write's value.
        const externalMsgs: Message[] = [{ id: 'ext', role: 'user', text: 'other tab' }];
        act(() => {
          window.dispatchEvent(new StorageEvent('storage', {
            key,
            newValue: JSON.stringify(externalMsgs),
            oldValue: null,
          }));
        });
        expect(result.current.value).toEqual(localMsgs);

        // Once the local write settles, the queued external event is applied.
        await act(async () => {
          setItemGate.resolve();
          for (let i = 0; i < 6; i += 1) await Promise.resolve();
        });
        expect(result.current.value).toEqual(externalMsgs);
      } finally {
        if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
        else Object.defineProperty(window, 'localStorage', { configurable: true, value: originalLocalStorage });
      }
    });

    it('drops an armed debounced write so it cannot clobber a cross-tab storage event', () => {
      vi.useFakeTimers();
      const key = 'chorus-cross-tab-armed-debounce';
      let unmount: (() => void) | undefined;
      try {
        const hook = renderHook(() => useChorusPersistence(key, { writeDebounceMs: 1000 }));
        unmount = hook.unmount;
        const { result } = hook;

        // Arm a debounced local write: its setTimeout is scheduled but has not
        // fired, so the write sits in pendingWriteRef with isWritePending()
        // still false — the lost-update window this test guards.
        const localMsgs: Message[] = [{ id: 'local', role: 'user', text: 'local edit' }];
        act(() => result.current.onChange(localMsgs));
        expect(result.current.value).toEqual(localMsgs);

        // Another tab writes and the storage event arrives while the timer is
        // still armed.
        const externalMsgs: Message[] = [{ id: 'ext', role: 'user', text: 'other tab' }];
        const externalPayload = JSON.stringify(externalMsgs);
        window.localStorage.setItem(key, externalPayload);
        act(() => dispatchStorageEvent(key, externalPayload));
        expect(result.current.value).toEqual(externalMsgs);

        // When the debounce window elapses the armed timer must not fire its
        // stale snapshot over the other tab's value.
        act(() => { vi.advanceTimersByTime(5000); });
        expect(result.current.value).toEqual(externalMsgs);
        expect(window.localStorage.getItem(key)).toBe(externalPayload);
      } finally {
        unmount?.();
        vi.useRealTimers();
        window.localStorage.removeItem(key);
      }
    });

    it('keeps an armed debounced write intact when a corrupt cross-tab event is rejected', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.useFakeTimers();
      const key = 'chorus-cross-tab-corrupt';
      let unmount: (() => void) | undefined;
      try {
        const hook = renderHook(() => useChorusPersistence(key, { writeDebounceMs: 1000 }));
        unmount = hook.unmount;
        const { result } = hook;

        // Arm a debounced local write: its setTimeout is scheduled but unfired,
        // so nothing has reached storage yet.
        const localMsgs: Message[] = [{ id: 'local', role: 'user', text: 'local edit' }];
        act(() => result.current.onChange(localMsgs));
        expect(result.current.value).toEqual(localMsgs);

        // A corrupt payload (another tab, a browser extension, an older library
        // version, or a partial QuotaExceededError write) arrives. It fails
        // JSON.parse, so applyExternalValue rejects it before applying.
        act(() => dispatchStorageEvent(key, '{ corrupt payload, not json'));

        // The rejected event must not desync in-memory state from storage.
        expect(result.current.value).toEqual(localMsgs);

        // The armed debounced write was NOT dropped by the rejected event: its
        // timer still fires and persists the local message that would otherwise
        // be lost on reload.
        act(() => { vi.advanceTimersByTime(2000); });
        expect(JSON.parse(window.localStorage.getItem(key) ?? 'null')).toEqual(localMsgs);
      } finally {
        unmount?.();
        vi.useRealTimers();
        window.localStorage.removeItem(key);
        errorSpy.mockRestore();
        warn.mockRestore();
      }
    });

    it('does not subscribe when a custom StorageAdapter is supplied', () => {
      const storage = makeSyncStorage(JSON.stringify(MSGS));
      const { result } = renderHook(() => useChorusPersistence('key', { storage }));
      expect(result.current.value).toEqual(MSGS);

      const replacement: Message[] = [{ id: 'z', role: 'user', text: 'foreign' }];
      act(() => dispatchStorageEvent('key', JSON.stringify(replacement)));

      expect(result.current.value).toEqual(MSGS);
    });
  });

  describe('default deserializer validation', () => {
    it('drops persisted tool messages that lack a valid toolCall and warns in dev', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const malformed = [{ id: 'bad', role: 'tool', text: '' }];
        const storage = makeSyncStorage(JSON.stringify(malformed));
        const { result } = renderHook(() => useChorusPersistence('key', { storage }));

        expect(result.current.value).toEqual([]);
        expect(result.current.error).toBeNull();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('Dropped 1 invalid persisted message'),
          expect.arrayContaining([
            expect.objectContaining({ index: 0, reason: expect.stringContaining('toolCall') }),
          ]),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('drops tool messages whose toolCall.name is whitespace-only and names the message id', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const malformed = [{ id: 'x', role: 'tool', toolCall: { id: 'x', name: ' ' } }];
        const storage = makeSyncStorage(JSON.stringify(malformed));
        const { result } = renderHook(() => useChorusPersistence('key', { storage }));

        expect(result.current.value).toEqual([]);
        expect(result.current.error).toBeNull();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('Dropped 1 invalid persisted message'),
          expect.arrayContaining([
            expect.objectContaining({ index: 0, id: 'x', reason: expect.stringContaining('toolCall') }),
          ]),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('keeps valid persisted messages and drops invalid neighbors', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const payload = [
          MSG,
          { id: '', role: 'user', text: 'no id' },
          { role: 'user', text: 'missing id field' },
          { id: 'x', role: 'wizard', text: 'bad role' },
          { id: 'y', role: 'assistant' },
          { id: 'tool-1', role: 'tool', toolCall: { name: 'lookup', input: { q: 'a' } } },
          { id: 'tool-2', role: 'tool', toolCall: {} },
          { id: 'tool-3', role: 'tool' },
          MSGS[1],
        ];
        const storage = makeSyncStorage(JSON.stringify(payload));
        const { result } = renderHook(() => useChorusPersistence('key', { storage }));

        expect(result.current.value).toEqual([
          MSG,
          { id: 'tool-1', role: 'tool', toolCall: { name: 'lookup', input: { q: 'a' } } },
          MSGS[1],
        ]);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('Dropped 6 invalid persisted messages'),
          expect.any(Array),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('drops a persisted message whose id is whitespace-only', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const storage = makeSyncStorage(JSON.stringify([
          { id: '   ', role: 'user', text: 'blank id' },
          MSG,
        ]));
        const { result } = renderHook(() => useChorusPersistence('key', { storage }));

        // A whitespace-only id is not a usable id: left in, it would reach
        // render and warnDuplicateMessageIds and collide there as a duplicate.
        expect(result.current.value).toEqual([MSG]);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('Dropped 1 invalid persisted message'),
          expect.any(Array),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('drops persisted entries that are not plain objects', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const storage = makeSyncStorage(JSON.stringify([null, 'not-a-message', 42, MSG]));
        const { result } = renderHook(() => useChorusPersistence('key', { storage }));

        expect(result.current.value).toEqual([MSG]);
      } finally {
        warn.mockRestore();
      }
    });

    it('drops attachments on roles that do not support them', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const payload = [
          {
            id: 'sys',
            role: 'system',
            text: 'rules',
            attachments: [{ name: 'a', type: 'text/plain', data: 'data:,a', size: 1 }],
          },
          {
            id: 'tool',
            role: 'tool',
            toolCall: { name: 'lookup' },
            attachments: [{ name: 'a', type: 'text/plain', data: 'data:,a', size: 1 }],
          },
          MSG,
        ];
        const storage = makeSyncStorage(JSON.stringify(payload));
        const { result } = renderHook(() => useChorusPersistence('key', { storage }));

        expect(result.current.value).toEqual([MSG]);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('Dropped 2 invalid persisted messages'),
          expect.arrayContaining([
            expect.objectContaining({ reason: expect.stringContaining('attachments') }),
          ]),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('drops user/assistant messages with non-string text', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const payload = [
          { id: 'a', role: 'user', text: 42 },
          { id: 'b', role: 'assistant' },
          MSG,
        ];
        const storage = makeSyncStorage(JSON.stringify(payload));
        const { result } = renderHook(() => useChorusPersistence('key', { storage }));

        expect(result.current.value).toEqual([MSG]);
      } finally {
        warn.mockRestore();
      }
    });

    it('drops persisted messages whose createdAt is present but not a string', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const payload = [
          { id: 'a', role: 'user', text: 'numeric', createdAt: 12345 },
          { id: 'b', role: 'assistant', text: 'object', createdAt: {} },
          { id: 'c', role: 'tool', toolCall: { name: 'lookup' }, createdAt: 99 },
          MSG,
        ];
        const storage = makeSyncStorage(JSON.stringify(payload));
        const { result } = renderHook(() => useChorusPersistence('key', { storage }));

        // A non-string createdAt would format to `Invalid Date` under
        // <Chorus showTimestamps>, so the default deserializer rejects it.
        expect(result.current.value).toEqual([MSG]);
        expect(result.current.error).toBeNull();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('Dropped 3 invalid persisted messages'),
          expect.arrayContaining([
            expect.objectContaining({ id: 'a', reason: expect.stringContaining('createdAt') }),
          ]),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('keeps a persisted message whose createdAt is a valid ISO-8601 string', () => {
      const withTimestamp = { id: 't', role: 'user', text: 'hi', createdAt: '2026-05-22T15:28:55.354Z' };
      const storage = makeSyncStorage(JSON.stringify([withTimestamp]));
      const { result } = renderHook(() => useChorusPersistence('key', { storage }));

      expect(result.current.value).toEqual([withTimestamp]);
    });

    it('accepts a valid tool message and preserves its toolCall fields', () => {
      const toolMessage = {
        id: 't-1',
        role: 'tool',
        text: '',
        toolCall: { id: 'call_123', name: 'web_search', input: { q: 'hi' }, output: 'result' },
      };
      const storage = makeSyncStorage(JSON.stringify([toolMessage]));
      const { result } = renderHook(() => useChorusPersistence('key', { storage }));

      expect(result.current.value).toEqual([toolMessage]);
    });

    it('loads an empty transcript and warns in dev for a non-array stored object', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const storage = makeSyncStorage(JSON.stringify({ messages: MSGS }));
        const { result } = renderHook(() => useChorusPersistence('key', { storage }));

        expect(result.current.value).toEqual([]);
        expect(result.current.error).toBeNull();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('Expected an array of persisted messages, got object'),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('stays silent for a stored JSON null payload', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const storage = makeSyncStorage(JSON.stringify(null));
        const { result } = renderHook(() => useChorusPersistence('key', { storage }));

        expect(result.current.value).toEqual([]);
        expect(result.current.error).toBeNull();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('warns in dev when a custom deserializer returns a non-array value', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const storage = makeSyncStorage('custom:read');
        const deserializeMessages = vi.fn(() => ({ messages: MSGS }) as unknown as Message[]);
        const { result } = renderHook(() =>
          useChorusPersistence('key', { storage, deserializeMessages }));

        expect(result.current.value).toEqual([]);
        expect(result.current.error).toBeNull();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('Expected an array of persisted messages, got object'),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('returns an empty array (not a deserialize error) for a corrupted payload', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const onError = vi.fn();
        const storage = makeSyncStorage(JSON.stringify([{ id: 'bad', role: 'tool', text: '' }]));
        const { result } = renderHook(() => useChorusPersistence('key', { storage, onError }));

        await act(async () => { await Promise.resolve(); });

        expect(result.current.value).toEqual([]);
        expect(result.current.error).toBeNull();
        expect(onError).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
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
