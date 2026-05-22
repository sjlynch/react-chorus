import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConversations } from '../hooks/useConversations';
import { useChorusPersistence } from '../hooks/useChorusPersistence';
import type { Message, StorageAdapter } from '../types';

async function flushMicrotasks(times = 6) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function makeSyncStorage(initial: Record<string, string> = {}): StorageAdapter & {
  store: Record<string, string>;
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
} {
  const store = { ...initial };
  return {
    store,
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => { store[key] = value; }),
    removeItem: vi.fn((key) => { delete store[key]; }),
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

function indexWriteCalls(storage: ReturnType<typeof makeSyncStorage>, key = 'chorus-conversations-index') {
  return storage.setItem.mock.calls.filter(([writtenKey]) => writtenKey === key);
}

describe('useConversations', () => {
  it('creates, selects, renames, and deletes conversations', () => {
    const storage = makeSyncStorage();
    const ids = ['one', 'two'];
    let tick = 0;
    const now = () => `2026-05-14T00:00:0${tick++}.000Z`;
    const { result } = renderHook(() => useConversations({
      storage,
      createId: () => ids.shift() ?? 'fallback',
      now,
    }));

    let first = '';
    let second = '';
    act(() => { first = result.current.createConversation('First'); });
    act(() => { second = result.current.createConversation('Second'); });

    expect(first).toBe('one');
    expect(second).toBe('two');
    expect(result.current.activeId).toBe('two');
    expect(result.current.activePersistenceKey).toBe('chorus-conversation:two');
    expect(result.current.conversations.map(conversation => conversation.title)).toEqual(['Second', 'First']);

    act(() => result.current.selectConversation(first));
    expect(result.current.activeId).toBe(first);

    act(() => result.current.renameConversation(first, 'Renamed'));
    expect(result.current.conversations.find(conversation => conversation.id === first)?.title).toBe('Renamed');

    storage.store['chorus-conversation:one'] = '[{"id":"m","role":"user","text":"hi"}]';
    act(() => result.current.deleteConversation(first));

    expect(storage.removeItem).toHaveBeenCalledWith('chorus-conversation:one');
    expect(storage.store['chorus-conversation:one']).toBeUndefined();
    expect(result.current.conversations.map(conversation => conversation.id)).toEqual(['two']);
    expect(result.current.activeId).toBe('two');
  });

  it('changes only activeId when selecting a conversation, leaving updatedAt untouched', () => {
    const storage = makeSyncStorage();
    const ids = ['old', 'new'];
    const times = [
      '2026-05-14T00:00:00.000Z',
      '2026-05-14T00:01:00.000Z',
      '2026-05-14T00:02:00.000Z',
    ];
    const now = () => times.shift() ?? '2026-05-14T00:03:00.000Z';
    const { result } = renderHook(() => useConversations({
      storage,
      createId: () => ids.shift() ?? 'fallback',
      now,
    }));

    act(() => { result.current.createConversation('Older'); });
    act(() => { result.current.createConversation('Newer'); });

    const updatedAtBefore = result.current.conversations.map(conversation => [conversation.id, conversation.updatedAt]);

    act(() => result.current.selectConversation('old'));

    expect(result.current.activeId).toBe('old');
    expect(result.current.conversations.map(conversation => [conversation.id, conversation.updatedAt]))
      .toEqual(updatedAtBefore);
    expect(result.current.conversations.find(conversation => conversation.id === 'old')?.updatedAt)
      .toBe('2026-05-14T00:00:00.000Z');

    // Recency sorting must keep the most-recently-modified conversation on top,
    // not the one that was just opened.
    const sortedIds = result.current.conversations
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map(conversation => conversation.id);
    expect(sortedIds).toEqual(['new', 'old']);
  });

  it('does not bump updatedAt when pinning or unpinning a conversation', () => {
    const storage = makeSyncStorage();
    const ids = ['stale'];
    const times = [
      '2026-01-01T00:00:00.000Z',
      '2099-01-01T00:00:00.000Z',
      '2099-01-01T00:00:01.000Z',
    ];
    const now = () => times.shift() ?? '2099-01-01T00:00:02.000Z';
    const { result } = renderHook(() => useConversations({
      storage,
      createId: () => ids.shift() ?? 'fallback',
      now,
    }));

    act(() => { result.current.createConversation('Stale'); });
    const originalUpdatedAt = result.current.conversations.find(conversation => conversation.id === 'stale')?.updatedAt;
    expect(originalUpdatedAt).toBe('2026-01-01T00:00:00.000Z');

    act(() => result.current.pinConversation('stale'));
    expect(result.current.conversations.find(conversation => conversation.id === 'stale')?.pinned).toBe(true);
    expect(result.current.conversations.find(conversation => conversation.id === 'stale')?.updatedAt).toBe(originalUpdatedAt);

    act(() => result.current.pinConversation('stale', false));
    expect(result.current.conversations.find(conversation => conversation.id === 'stale')?.pinned).toBe(false);
    expect(result.current.conversations.find(conversation => conversation.id === 'stale')?.updatedAt).toBe(originalUpdatedAt);
  });

  it('persists the conversation index under a configurable key', () => {
    const storage = makeSyncStorage();
    const { result } = renderHook(() => useConversations({
      storage,
      indexKey: 'custom-index',
      messageKeyPrefix: 'chat:',
      createId: () => 'abc',
      now: () => '2026-05-14T00:00:00.000Z',
    }));

    act(() => { result.current.createConversation('Project chat'); });

    expect(result.current.activePersistenceKey).toBe('chat:abc');
    expect(JSON.parse(storage.store['custom-index'])).toEqual({
      activeId: 'abc',
      conversations: [{
        id: 'abc',
        title: 'Project chat',
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
        pristine: false,
      }],
    });
  });

  it('loads an existing persisted index', () => {
    const storage = makeSyncStorage({
      'chorus-conversations-index': JSON.stringify({
        activeId: 'b',
        conversations: [
          { id: 'a', title: 'A', createdAt: '2026-05-14T00:00:00.000Z', updatedAt: '2026-05-14T00:00:00.000Z' },
          { id: 'b', title: 'B', createdAt: '2026-05-14T00:00:01.000Z', updatedAt: '2026-05-14T00:00:01.000Z' },
        ],
      }),
    });

    const { result } = renderHook(() => useConversations({ storage }));

    expect(result.current.conversations.map(conversation => conversation.id)).toEqual(['a', 'b']);
    expect(result.current.activeId).toBe('b');
  });

  it('drops a stored index entry with an empty-string id during parse', () => {
    const storage = makeSyncStorage({
      'chorus-conversations-index': JSON.stringify({
        activeId: 'b',
        conversations: [
          { id: '', title: 'Blank id', createdAt: '2026-05-14T00:00:00.000Z', updatedAt: '2026-05-14T00:00:00.000Z' },
          { id: '   ', title: 'Whitespace id', createdAt: '2026-05-14T00:00:00.000Z', updatedAt: '2026-05-14T00:00:00.000Z' },
          { id: 'b', title: 'B', createdAt: '2026-05-14T00:00:01.000Z', updatedAt: '2026-05-14T00:00:01.000Z' },
        ],
      }),
    });

    const { result } = renderHook(() => useConversations({ storage }));

    // A zero-length or blank id collapses getPersistenceKey() to the bare
    // messageKeyPrefix, so such entries are dropped like a malformed message.
    expect(result.current.conversations.map(conversation => conversation.id)).toEqual(['b']);
    expect(result.current.activeId).toBe('b');
  });

  it('preserves legacy index entries that are missing timestamps', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = makeSyncStorage({
      'chorus-conversations-index': JSON.stringify([{ id: 'a', title: 'old' }]),
    });

    try {
      const { result } = renderHook(() => useConversations({
        storage,
        now: () => '2026-05-14T00:00:00.000Z',
      }));

      expect(result.current.conversations).toEqual([{
        id: 'a',
        title: 'old',
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
        pristine: false,
      }]);
      expect(result.current.activeId).toBe('a');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('backfilling missing createdAt and updatedAt'));
    } finally {
      warn.mockRestore();
    }
  });

  it('queues pre-load createConversation until the async index read resolves', async () => {
    const pendingRead = deferred<string | null>();
    const storedConversation = {
      id: 'existing',
      title: 'Existing chat',
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    };
    const store: Record<string, string> = {};
    const storage: StorageAdapter = {
      getItem: vi.fn(() => pendingRead.promise),
      setItem: vi.fn((key, value) => { store[key] = value; }),
      removeItem: vi.fn(),
    };

    const { result } = renderHook(() => useConversations({
      storage,
      createId: () => 'queued',
      now: () => '2026-05-14T00:01:00.000Z',
    }));

    expect(result.current.loaded).toBe(false);
    let createdId = '';
    act(() => { createdId = result.current.createConversation('Queued chat'); });

    expect(createdId).toBe('queued');
    expect(result.current.conversations).toEqual([]);
    expect(storage.setItem).not.toHaveBeenCalled();

    await act(async () => {
      pendingRead.resolve(JSON.stringify({ activeId: 'existing', conversations: [storedConversation] }));
      await pendingRead.promise;
    });

    expect(result.current.loaded).toBe(true);
    expect(result.current.activeId).toBe('queued');
    expect(result.current.conversations.map(conversation => conversation.id)).toEqual(['queued', 'existing']);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store['chorus-conversations-index'])).toEqual({
      activeId: 'queued',
      conversations: [
        {
          id: 'queued',
          title: 'Queued chat',
          createdAt: '2026-05-14T00:01:00.000Z',
          updatedAt: '2026-05-14T00:01:00.000Z',
          pristine: false,
        },
        { ...storedConversation, pristine: false },
      ],
    });
  });

  it('returns a storage wrapper that touches updatedAt when conversation messages are written', () => {
    const storage = makeSyncStorage();
    let currentTime = '2026-05-14T00:00:00.000Z';
    const { result } = renderHook(() => useConversations({
      storage,
      createId: () => 'abc',
      now: () => currentTime,
    }));

    act(() => { result.current.createConversation('Touched'); });
    currentTime = '2026-05-14T00:00:05.000Z';

    act(() => { result.current.storage?.setItem('chorus-conversation:abc', '[]'); });

    expect(result.current.conversations[0].updatedAt).toBe('2026-05-14T00:00:05.000Z');
  });

  it('debounces index writes caused by rapid transcript writes', async () => {
    vi.useFakeTimers();
    const storage = makeSyncStorage();
    let tick = 0;
    const { result, unmount } = renderHook(() => useConversations({
      storage,
      createId: () => 'abc',
      now: () => `2026-05-14T00:00:${String(tick++).padStart(2, '0')}.000Z`,
    }));

    try {
      act(() => { result.current.createConversation('Touched'); });
      await act(async () => { await Promise.resolve(); });
      storage.setItem.mockClear();

      act(() => {
        for (let i = 0; i < 10; i += 1) {
          result.current.storage?.setItem('chorus-conversation:abc', `[{"id":"${i}"}]`);
        }
      });

      expect(indexWriteCalls(storage)).toHaveLength(0);

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      expect(indexWriteCalls(storage).length).toBeGreaterThan(0);
      expect(indexWriteCalls(storage).length).toBeLessThanOrEqual(2);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('renames a default-titled conversation from the first user message', () => {
    const storage = makeSyncStorage();
    const { result } = renderHook(() => useConversations({
      storage,
      createId: () => 'abc',
      now: () => '2026-05-14T00:00:00.000Z',
      defaultTitle: 'New chat',
    }));

    act(() => { result.current.createConversation(); });
    act(() => result.current.renameFromFirstMessage('abc', [
      { role: 'assistant', text: 'Welcome' },
      { role: 'user', text: '  Please summarize this very long document for the weekly leadership review  ' },
    ], { maxLength: 22 }));

    expect(result.current.conversations[0].title).toBe('Please summarize this…');

    act(() => result.current.renameFromFirstMessage('abc', [{ role: 'user', text: 'Do not overwrite' }]));
    expect(result.current.conversations[0].title).toBe('Please summarize this…');
  });

  it('auto-renames an unmodified pristine conversation after defaultTitle changes', () => {
    const storage = makeSyncStorage();
    const { result, rerender } = renderHook(
      ({ defaultTitle }) => useConversations({
        storage,
        createId: () => 'abc',
        now: () => '2026-05-14T00:00:00.000Z',
        defaultTitle,
      }),
      { initialProps: { defaultTitle: 'New chat' } },
    );

    act(() => { result.current.createConversation(); });
    expect(result.current.conversations[0]).toEqual(expect.objectContaining({ title: 'New chat', pristine: true }));

    rerender({ defaultTitle: 'Untitled' });
    act(() => result.current.renameFromFirstMessage('abc', [{ role: 'user', text: 'Workspace question' }]));

    expect(result.current.conversations[0]).toEqual(expect.objectContaining({
      title: 'Workspace question',
      pristine: false,
    }));
  });

  it('titles an assistant-first conversation when includeRoles allows the assistant role', () => {
    const storage = makeSyncStorage();
    const { result } = renderHook(() => useConversations({
      storage,
      createId: () => 'abc',
      now: () => '2026-05-14T00:00:00.000Z',
      defaultTitle: 'New chat',
    }));

    act(() => { result.current.createConversation(); });

    const seeded: Pick<Message, 'role' | 'text'>[] = [
      { role: 'system', text: 'You are a helpful assistant.' },
      { role: 'assistant', text: 'Hi! How can I help you today?' },
    ];

    // Default (user-only) sourcing ignores the assistant greeting.
    act(() => result.current.renameFromFirstMessage('abc', seeded));
    expect(result.current.conversations[0].title).toBe('New chat');

    // includeRoles lets the title come from the first assistant message.
    act(() => result.current.renameFromFirstMessage('abc', seeded, { includeRoles: ['assistant'] }));
    expect(result.current.conversations[0].title).toBe('Hi! How can I help you today?');
  });

  it('surfaces invalid index JSON through error and onError while falling back to empty state', async () => {
    const onError = vi.fn();
    const storage = makeSyncStorage({ 'chorus-conversations-index': 'not json {{' });

    const { result } = renderHook(() => useConversations({ storage, onError }));

    expect(result.current.conversations).toEqual([]);
    expect(result.current.error).toEqual(expect.objectContaining({
      key: 'chorus-conversations-index',
      operation: 'read',
    }));
    await act(async () => { await Promise.resolve(); });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ operation: 'read', key: 'chorus-conversations-index' }));
  });

  it('surfaces rejected async index reads through error and onError', async () => {
    const readError = new Error('blocked');
    const onError = vi.fn();
    const storage: StorageAdapter = {
      getItem: vi.fn().mockRejectedValue(readError),
      setItem: vi.fn(),
    };

    const { result } = renderHook(() => useConversations({ storage, onError }));

    await act(async () => { await Promise.resolve(); });

    expect(result.current.conversations).toEqual([]);
    expect(result.current.error).toEqual(expect.objectContaining({ operation: 'read', key: 'chorus-conversations-index' }));
    expect(result.current.error?.cause).toBe(readError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ operation: 'read', key: 'chorus-conversations-index' }));
  });

  it('surfaces rejected index writes through error and onError while keeping in-memory state', async () => {
    const writeError = new Error('quota');
    const onError = vi.fn();
    const storage: StorageAdapter = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => Promise.reject(writeError)),
      removeItem: vi.fn(),
    };

    const { result } = renderHook(() => useConversations({ storage, onError, createId: () => 'abc' }));

    act(() => { result.current.createConversation('Saved in memory'); });
    expect(result.current.conversations[0].title).toBe('Saved in memory');

    await act(async () => { await Promise.resolve(); });

    expect(result.current.error).toEqual(expect.objectContaining({ operation: 'write', key: 'chorus-conversations-index' }));
    expect(result.current.error?.cause).toBe(writeError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ operation: 'write', key: 'chorus-conversations-index' }));
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

    function makeConversation(id: string, title: string) {
      return {
        id,
        title,
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
        pristine: false,
      };
    }

    it('picks up index writes from another tab via the storage event', () => {
      const indexKey = 'chorus-cross-tab-index-pickup';
      try {
        const { result } = renderHook(() => useConversations({ indexKey }));
        expect(result.current.conversations).toEqual([]);

        const payload = JSON.stringify({
          activeId: 'from-a',
          conversations: [makeConversation('from-a', 'From tab A')],
        });
        window.localStorage.setItem(indexKey, payload);
        act(() => dispatchStorageEvent(indexKey, payload));

        expect(result.current.conversations.map(c => c.id)).toEqual(['from-a']);
        expect(result.current.activeId).toBe('from-a');
      } finally {
        window.localStorage.removeItem(indexKey);
      }
    });

    it('preserves the local active selection when the synced index still contains it', () => {
      const indexKey = 'chorus-cross-tab-index-active';
      try {
        const ids = ['local'];
        const { result } = renderHook(() => useConversations({
          indexKey,
          createId: () => ids.shift() ?? 'fallback',
          now: () => '2026-05-14T00:01:00.000Z',
        }));
        act(() => { result.current.createConversation('Local'); });
        expect(result.current.activeId).toBe('local');

        const payload = JSON.stringify({
          activeId: 'from-a',
          conversations: [
            makeConversation('from-a', 'From A'),
            makeConversation('local', 'Local'),
          ],
        });
        window.localStorage.setItem(indexKey, payload);
        act(() => dispatchStorageEvent(indexKey, payload));

        expect(result.current.conversations.map(c => c.id).sort()).toEqual(['from-a', 'local']);
        expect(result.current.activeId).toBe('local');
      } finally {
        window.localStorage.removeItem(indexKey);
      }
    });

    it('lets a subsequent createConversation merge with another tab\'s entries rather than stomping them', () => {
      const indexKey = 'chorus-cross-tab-index-merge';
      try {
        const ids = ['from-b'];
        const { result } = renderHook(() => useConversations({
          indexKey,
          createId: () => ids.shift() ?? 'fallback',
          now: () => '2026-05-14T00:02:00.000Z',
        }));

        const payload = JSON.stringify({
          activeId: 'from-a',
          conversations: [makeConversation('from-a', 'From A')],
        });
        window.localStorage.setItem(indexKey, payload);
        act(() => dispatchStorageEvent(indexKey, payload));
        expect(result.current.conversations.map(c => c.id)).toEqual(['from-a']);

        act(() => { result.current.createConversation('From B'); });

        const stored = JSON.parse(window.localStorage.getItem(indexKey) ?? '{}');
        expect(stored.conversations.map((c: { id: string }) => c.id).sort()).toEqual(['from-a', 'from-b']);
      } finally {
        window.localStorage.removeItem(indexKey);
      }
    });

    it('ignores storage events that mirror the current in-memory index (polyfill defense)', () => {
      const indexKey = 'chorus-cross-tab-index-mirror';
      try {
        const { result } = renderHook(() => useConversations({
          indexKey,
          createId: () => 'abc',
          now: () => '2026-05-14T00:00:00.000Z',
        }));
        act(() => { result.current.createConversation('Mirror'); });
        const previousConversations = result.current.conversations;

        const sameValue = window.localStorage.getItem(indexKey);
        act(() => dispatchStorageEvent(indexKey, sameValue));

        expect(result.current.conversations).toBe(previousConversations);
      } finally {
        window.localStorage.removeItem(indexKey);
      }
    });

    it('does not subscribe when a custom StorageAdapter is supplied', () => {
      const storage = makeSyncStorage();
      const { result } = renderHook(() => useConversations({
        storage,
        createId: () => 'b',
        now: () => '2026-05-14T00:03:00.000Z',
      }));
      act(() => { result.current.createConversation('B'); });
      expect(result.current.conversations.map(c => c.id)).toEqual(['b']);

      act(() => dispatchStorageEvent('chorus-conversations-index', JSON.stringify({
        activeId: 'a',
        conversations: [makeConversation('a', 'A')],
      })));

      expect(result.current.conversations.map(c => c.id)).toEqual(['b']);
    });

    it('drops an armed debounced index write so it cannot clobber a cross-tab storage event', () => {
      vi.useFakeTimers();
      const indexKey = 'chorus-cross-tab-index-armed-debounce';
      const transcriptKey = 'chorus-conversation:local';
      let unmount: (() => void) | undefined;
      try {
        const ids = ['local'];
        const hook = renderHook(() => useConversations({
          indexKey,
          createId: () => ids.shift() ?? 'fallback',
          now: () => '2026-05-21T00:00:00.000Z',
        }));
        unmount = hook.unmount;
        const { result } = hook;

        // Create a conversation (immediate index write), then touch it with a
        // transcript write — touchConversation commits in 'debounced' mode,
        // arming the index write's debounce timer without starting it.
        act(() => { result.current.createConversation('Local chat'); });
        act(() => { result.current.storage?.setItem(transcriptKey, '[{"id":"m","role":"user","text":"hi"}]'); });

        // Another tab writes the index and the storage event arrives while the
        // debounce timer is still armed.
        const externalPayload = JSON.stringify({
          activeId: 'from-b',
          conversations: [makeConversation('from-b', 'From tab B')],
        });
        window.localStorage.setItem(indexKey, externalPayload);
        act(() => dispatchStorageEvent(indexKey, externalPayload));
        expect(result.current.conversations.map(c => c.id)).toEqual(['from-b']);

        // When the debounce window elapses the armed timer must not fire its
        // stale index snapshot over the other tab's conversation.
        act(() => { vi.advanceTimersByTime(5000); });
        expect(result.current.conversations.map(c => c.id)).toEqual(['from-b']);
        const stored = JSON.parse(window.localStorage.getItem(indexKey) ?? '{}');
        expect(stored.conversations.map((c: { id: string }) => c.id)).toEqual(['from-b']);
      } finally {
        unmount?.();
        vi.useRealTimers();
        window.localStorage.removeItem(indexKey);
        window.localStorage.removeItem(transcriptKey);
      }
    });

    it('defers a cross-tab index event behind an in-flight index write (no lost update)', async () => {
      const indexKey = 'chorus-cross-tab-index-inflight';
      const setItemGate = deferred<void>();
      let indexSetItemCalls = 0;
      const store: Record<string, string> = {};
      const asyncLocalStorage: StorageAdapter = {
        getItem: (key) => Promise.resolve(store[key] ?? null),
        setItem: (key, value) => {
          store[key] = value;
          if (key !== indexKey) return Promise.resolve();
          indexSetItemCalls += 1;
          return setItemGate.promise;
        },
      };
      const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
      const originalLocalStorage = window.localStorage;
      Object.defineProperty(window, 'localStorage', { configurable: true, value: asyncLocalStorage });

      try {
        const { result } = renderHook(() => useConversations({
          indexKey,
          createId: () => 'tab-a',
          now: () => '2026-05-21T00:00:00.000Z',
        }));
        await act(async () => { await flushMicrotasks(); });
        expect(result.current.loaded).toBe(true);

        // A local index write starts and stays in flight (its setItem is gated).
        act(() => { result.current.createConversation('Tab A chat'); });
        expect(indexSetItemCalls).toBe(1);
        expect(result.current.conversations.map(c => c.id)).toEqual(['tab-a']);

        // Another tab's index event arrives mid-write — applying it now would be
        // clobbered when the in-flight write persists its stale snapshot.
        const externalPayload = JSON.stringify({
          activeId: 'tab-b',
          conversations: [makeConversation('tab-b', 'Tab B chat')],
        });
        // Dispatched without storageArea — the swapped-in async adapter is not a
        // real Storage instance, which jsdom's StorageEvent constructor rejects.
        act(() => {
          window.dispatchEvent(new StorageEvent('storage', {
            key: indexKey,
            newValue: externalPayload,
            oldValue: null,
          }));
        });
        expect(result.current.conversations.map(c => c.id)).toEqual(['tab-a']);

        // Once the local write settles, the deferred event is rebased and applied.
        await act(async () => {
          setItemGate.resolve();
          await flushMicrotasks();
        });
        expect(result.current.conversations.map(c => c.id)).toEqual(['tab-b']);
      } finally {
        if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
        else Object.defineProperty(window, 'localStorage', { configurable: true, value: originalLocalStorage });
      }
    });
  });

  it('surfaces failed transcript deletion through error and onError while deleting the index entry', async () => {
    const deleteError = new Error('delete failed');
    const onError = vi.fn();
    const storage = makeSyncStorage();
    storage.removeItem.mockImplementation(() => { throw deleteError; });
    const { result } = renderHook(() => useConversations({ storage, onError, createId: () => 'abc' }));

    act(() => { result.current.createConversation('Delete me'); });
    act(() => result.current.deleteConversation('abc'));

    expect(result.current.conversations).toEqual([]);
    expect(result.current.error).toEqual(expect.objectContaining({
      operation: 'delete',
      key: 'chorus-conversation:abc',
      conversationId: 'abc',
    }));
    expect(result.current.error?.cause).toBe(deleteError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ operation: 'delete', key: 'chorus-conversation:abc' }));
  });

  it('reports a fallback transcript-delete (no removeItem) setItem failure as a delete error', () => {
    const deleteError = new Error('quota exceeded');
    const onError = vi.fn();
    const store: Record<string, string> = {};
    // Adapter with no removeItem: transcript deletion falls back to
    // setItem(key, '[]'). A failure of that fallback is still classified as a
    // 'delete' error (matching the removeItem path) so a later successful index
    // write cannot dismiss it — see the "Known divergence" in conversations/CLAUDE.md.
    const storage: StorageAdapter = {
      getItem: (key) => store[key] ?? null,
      setItem: (key, value) => {
        if (key === 'chorus-conversation:abc') throw deleteError;
        store[key] = value;
      },
    };
    const { result } = renderHook(() => useConversations({ storage, onError, createId: () => 'abc' }));

    act(() => { result.current.createConversation('Delete me'); });
    act(() => result.current.deleteConversation('abc'));

    expect(result.current.conversations).toEqual([]);
    expect(result.current.error).toEqual(expect.objectContaining({
      operation: 'delete',
      key: 'chorus-conversation:abc',
      conversationId: 'abc',
    }));
    expect(result.current.error?.cause).toBe(deleteError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ operation: 'delete', key: 'chorus-conversation:abc' }));
  });

  it('skips setError but still notifies onError when an async index write rejects after unmount', async () => {
    const writeError = new Error('quota exceeded');
    const onError = vi.fn();
    const writeGate = deferred<void>();
    const store: Record<string, string> = {};
    const storage: StorageAdapter = {
      getItem: (key) => store[key] ?? null,
      setItem: (key, value) => {
        store[key] = value;
        return writeGate.promise;
      },
      removeItem: () => {},
    };
    const { result, unmount } = renderHook(() => useConversations({
      storage,
      onError,
      createId: () => 'abc',
      now: () => '2026-05-21T00:00:00.000Z',
    }));

    act(() => { result.current.createConversation('First'); });
    unmount();

    // The index write rejects only after the component unmounted: setError is
    // gated on mountedRef, but onError still fires so the host can log it.
    await act(async () => {
      writeGate.reject(writeError);
      await flushMicrotasks();
    });

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ operation: 'write' }));
  });

  it('clears a stale write error once a later index write succeeds', async () => {
    let indexWriteCount = 0;
    const store: Record<string, string> = {};
    const storage: StorageAdapter = {
      getItem: (key) => store[key] ?? null,
      setItem: (key, value) => {
        store[key] = value;
        indexWriteCount += 1;
        return indexWriteCount === 1 ? Promise.reject(new Error('quota')) : Promise.resolve();
      },
      removeItem: () => {},
    };
    const ids = ['first', 'second'];
    const { result } = renderHook(() => useConversations({
      storage,
      createId: () => ids.shift() ?? 'fallback',
      now: () => '2026-05-21T00:00:00.000Z',
    }));

    act(() => { result.current.createConversation('First'); });
    await act(async () => { await flushMicrotasks(); });
    expect(result.current.error).toEqual(expect.objectContaining({ operation: 'write' }));

    // A later successful index write must dismiss the stale error so a host's
    // persistence-error banner can clear without a full index reload.
    act(() => { result.current.createConversation('Second'); });
    await act(async () => { await flushMicrotasks(); });
    expect(result.current.error).toBeNull();
  });

  it('warns and does not misclassify an index write when indexKey shares the messageKeyPrefix', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = makeSyncStorage();
    let currentTime = '2026-05-21T00:00:00.000Z';
    try {
      const { result } = renderHook(() => useConversations({
        storage,
        indexKey: 'chorus-index',
        messageKeyPrefix: 'chorus-',
        createId: () => 'index',
        now: () => currentTime,
      }));

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('starts with messageKeyPrefix'));

      act(() => { result.current.createConversation('Index-named'); });
      const updatedAtBefore = result.current.conversations[0].updatedAt;
      expect(updatedAtBefore).toBe('2026-05-21T00:00:00.000Z');

      // Writing the index key through the wrapped transcript adapter must not be
      // treated as a transcript write for the conversation whose id is 'index'.
      currentTime = '2026-05-21T12:00:00.000Z';
      act(() => { result.current.storage?.setItem('chorus-index', '{"conversations":[],"activeId":null}'); });

      expect(result.current.conversations[0].updatedAt).toBe(updatedAtBefore);
    } finally {
      warn.mockRestore();
    }
  });

  describe('pre-index-load send window', () => {
    function makeIndexAsyncStorage(pendingRead: Promise<string | null>) {
      const store: Record<string, string> = {};
      const storage: StorageAdapter = {
        getItem: vi.fn((key: string) => (
          key === 'chorus-conversations-index' ? pendingRead : (store[key] ?? null)
        )),
        setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
        removeItem: vi.fn((key: string) => { delete store[key]; }),
      };
      return { storage, store };
    }

    const existingIndex = JSON.stringify({
      activeId: 'existing',
      conversations: [{
        id: 'existing',
        title: 'Existing chat',
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
        pristine: false,
      }],
    });

    // Models exactly what <Chorus> wires internally: useChorusPersistence keyed
    // on useConversations().activePersistenceKey.
    function renderConversationPersistence(storage: StorageAdapter) {
      return renderHook(() => {
        const conversations = useConversations({ storage });
        const persistence = useChorusPersistence(conversations.activePersistenceKey, {
          storage: conversations.activePersistenceKey ? conversations.storage : null,
        });
        return { conversations, persistence };
      });
    }

    it('drops a message persisted before the conversation index finishes loading', async () => {
      const pendingRead = deferred<string | null>();
      const { storage, store } = makeIndexAsyncStorage(pendingRead.promise);
      const { result } = renderConversationPersistence(storage);

      // Pre-index-load window: no active conversation, so no persistence key.
      expect(result.current.conversations.loaded).toBe(false);
      expect(result.current.conversations.activePersistenceKey).toBe('');

      // A user sends a message during the window.
      const earlyMessage: Message[] = [{ id: 'lost', role: 'user', text: 'sent too early' }];
      act(() => { result.current.persistence.onChange(earlyMessage); });

      // The index read resolves and an existing conversation becomes active.
      await act(async () => {
        pendingRead.resolve(existingIndex);
        await flushMicrotasks();
      });

      expect(result.current.conversations.loaded).toBe(true);
      expect(result.current.conversations.activePersistenceKey).toBe('chorus-conversation:existing');

      // The early message was dropped: it never reached a transcript key and the
      // now-active conversation loads empty.
      expect(result.current.persistence.value).toEqual([]);
      expect(store['chorus-conversation:existing']).toBeUndefined();
      const wroteEarlyMessage = (storage.setItem as ReturnType<typeof vi.fn>).mock.calls
        .some(([, value]) => typeof value === 'string' && value.includes('sent too early'));
      expect(wroteEarlyMessage).toBe(false);
    });

    it('persists a message sent once the conversation index reports loaded', async () => {
      // The documented remedy for the window above: gate sending on `loaded`.
      const pendingRead = deferred<string | null>();
      const { storage, store } = makeIndexAsyncStorage(pendingRead.promise);
      const { result } = renderConversationPersistence(storage);

      await act(async () => {
        pendingRead.resolve(existingIndex);
        await flushMicrotasks();
      });
      expect(result.current.conversations.loaded).toBe(true);

      const message: Message[] = [{ id: 'kept', role: 'user', text: 'sent after load' }];
      act(() => { result.current.persistence.onChange(message, { flush: true }); });

      expect(result.current.persistence.value).toEqual(message);
      expect(store['chorus-conversation:existing']).toContain('sent after load');
    });
  });
});
