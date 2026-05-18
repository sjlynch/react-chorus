import React from 'react';
import type { StorageAdapter } from '../../types';

interface UseConversationIndexFlushLifecycleOptions {
  storage: StorageAdapter | null;
  indexKey: string;
  flushPendingIndexWrite: () => void;
}

export function useConversationIndexFlushLifecycle({
  storage,
  indexKey,
  flushPendingIndexWrite,
}: UseConversationIndexFlushLifecycleOptions) {
  React.useEffect(() => () => {
    flushPendingIndexWrite();
  }, [flushPendingIndexWrite, indexKey, storage]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const handlePageHide = () => flushPendingIndexWrite();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushPendingIndexWrite();
    };

    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flushPendingIndexWrite]);
}
