import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConversationMetadata } from '../hooks/useConversationMetadata';
import type { StorageAdapter } from '../types';

function makeSyncStorage(seed: Record<string, string> = {}): StorageAdapter & { store: Record<string, string>; removeCalls: string[] } {
  const store: Record<string, string> = { ...seed };
  const removeCalls: string[] = [];
  return {
    store,
    removeCalls,
    getItem: (key: string) => (key in store ? store[key]! : null),
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { removeCalls.push(key); delete store[key]; },
  };
}

function makeAsyncStorage(seed: Record<string, string> = {}): StorageAdapter & { store: Record<string, string> } {
  const store: Record<string, string> = { ...seed };
  return {
    store,
    getItem: async (key: string) => (key in store ? store[key]! : null),
    setItem: async (key: string, value: string) => { store[key] = value; },
    removeItem: async (key: string) => { delete store[key]; },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useConversationMetadata — synchronous storage', () => {
  it('returns null when the key is empty (no persistence wired)', () => {
    const { result } = renderHook(() => useConversationMetadata('', { storage: makeSyncStorage() }));
    expect(result.current.value).toBeNull();
    expect(result.current.loaded).toBe(true);
    expect(result.current.canPersist).toBe(false);
  });

  it('reads stored JSON on mount and exposes the parsed object', () => {
    const storage = makeSyncStorage({ 'chat-1::meta': JSON.stringify({ characterId: 'hook', persona: 'wendy' }) });
    const { result } = renderHook(() => useConversationMetadata('chat-1::meta', { storage }));
    expect(result.current.loaded).toBe(true);
    expect(result.current.value).toEqual({ characterId: 'hook', persona: 'wendy' });
    expect(result.current.canPersist).toBe(true);
  });

  it('returns null when the stored JSON is malformed', () => {
    const storage = makeSyncStorage({ 'chat-1::meta': '{not valid json' });
    const { result } = renderHook(() => useConversationMetadata('chat-1::meta', { storage }));
    expect(result.current.value).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('persists subsequent setValue calls back to storage', async () => {
    const storage = makeSyncStorage();
    const { result } = renderHook(() => useConversationMetadata('chat-1::meta', { storage }));
    act(() => result.current.setValue({ characterId: 'hook' }));
    expect(result.current.value).toEqual({ characterId: 'hook' });
    await waitFor(() => expect(storage.store['chat-1::meta']).toBe(JSON.stringify({ characterId: 'hook' })));
  });

  it('removes the slot via removeItem when setValue(null) is called', async () => {
    const storage = makeSyncStorage({ 'chat-1::meta': JSON.stringify({ characterId: 'hook' }) });
    const { result } = renderHook(() => useConversationMetadata('chat-1::meta', { storage }));
    expect(result.current.value).toEqual({ characterId: 'hook' });
    act(() => result.current.setValue(null));
    expect(result.current.value).toBeNull();
    await waitFor(() => expect(storage.removeCalls).toContain('chat-1::meta'));
    expect('chat-1::meta' in storage.store).toBe(false);
  });

  it('re-reads when the key changes between renders', () => {
    const storage = makeSyncStorage({
      'chat-a::meta': JSON.stringify({ which: 'a' }),
      'chat-b::meta': JSON.stringify({ which: 'b' }),
    });
    const { result, rerender } = renderHook(({ key }: { key: string }) => useConversationMetadata(key, { storage }), {
      initialProps: { key: 'chat-a::meta' },
    });
    expect(result.current.value).toEqual({ which: 'a' });
    rerender({ key: 'chat-b::meta' });
    expect(result.current.value).toEqual({ which: 'b' });
  });
});

describe('useConversationMetadata — async storage', () => {
  it('starts unloaded then resolves to the stored value', async () => {
    const storage = makeAsyncStorage({ 'chat-1::meta': JSON.stringify({ characterId: 'smee' }) });
    const { result } = renderHook(() => useConversationMetadata('chat-1::meta', { storage }));
    expect(result.current.loaded).toBe(false);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.value).toEqual({ characterId: 'smee' });
  });

  it('surfaces a load error through onError and keeps loaded=true', async () => {
    const storage: StorageAdapter = {
      getItem: async () => { throw new Error('boom'); },
      setItem: async () => undefined,
    };
    const onError = vi.fn();
    const { result } = renderHook(() => useConversationMetadata('chat-1::meta', { storage, onError }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.loaded).toBe(true);
    expect(result.current.value).toBeNull();
  });
});
