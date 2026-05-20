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
    expect(result.current.error).toBe(readError);
    expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'read' }));
    expect(onError).toHaveBeenCalledWith(readError);
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
    expect(result.current.error).toBe(deserializeError);
    expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'deserialize' }));
    await act(async () => { await Promise.resolve(); });
    expect(onError).toHaveBeenCalledWith(deserializeError);
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
    expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'write' }));
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
    expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'write' }));
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

  it('records and surfaces removeItem failures with remove context', async () => {
    const removeError = new Error('remove failed');
    const onError = vi.fn();
    const storage = makeSyncStorage(JSON.stringify(MSGS));
    storage.removeItem = vi.fn(() => { throw removeError; });
    const { result } = renderHook(() => useChorusPersistence('key', { storage, onError }));

    act(() => result.current.onChange([], { flush: true, removeIfEmpty: true }));

    expect(result.current.error).toBe(removeError);
    expect(result.current.error).toEqual(expect.objectContaining({ key: 'key', operation: 'remove' }));
    expect(onError).toHaveBeenCalledWith(removeError);
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
