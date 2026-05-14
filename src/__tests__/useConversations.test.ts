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
});
