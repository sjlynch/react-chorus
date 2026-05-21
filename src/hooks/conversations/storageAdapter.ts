import type { StorageAdapter } from '../../types';
import { isPromiseLike } from '../../utils/async';

export function getConversationIdFromKey(key: string, prefix: string) {
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

export function createConversationStorageAdapter(
  storage: StorageAdapter | null,
  messageKeyPrefix: string,
  indexKey: string,
  touchConversation: (id: string) => void,
): StorageAdapter | null {
  if (!storage) return storage;

  const touchAfterWrite = (key: string, result: void | Promise<void>) => {
    // The conversation index can share the message key prefix under a custom
    // config (e.g. messageKeyPrefix 'chorus-' + indexKey 'chorus-index'). An
    // index write is not a transcript write, so never derive a conversation id
    // from it — that would touch a conversation whose id equals the index
    // suffix and corrupt recency sorting.
    if (key === indexKey) return;

    const conversationId = getConversationIdFromKey(key, messageKeyPrefix);
    if (!conversationId) return;

    if (isPromiseLike<void>(result)) {
      Promise.resolve(result).then(() => touchConversation(conversationId)).catch(() => {});
    } else {
      touchConversation(conversationId);
    }
  };

  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => {
      const result = storage.setItem(key, value);
      touchAfterWrite(key, result);
      return result;
    },
    ...(storage.removeItem ? {
      removeItem: (key: string) => {
        const result = storage.removeItem?.(key);
        touchAfterWrite(key, result);
        return result;
      },
    } : {}),
  };
}
