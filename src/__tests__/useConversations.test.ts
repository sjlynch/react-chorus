import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConversations } from '../hooks/useConversations';
import type { StorageAdapter } from '../types';

function makeSyncStorage(initial: Record<string, string> = {}): StorageAdapter & { store: Record<string, string>; removeItem: ReturnType<typeof vi.fn> } {
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
        },
        storedConversation,
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
});
