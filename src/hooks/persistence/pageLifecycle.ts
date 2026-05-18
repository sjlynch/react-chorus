import React from 'react';

export function usePageLifecycleFlush(flushForPageLifecycle: () => void) {
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const handlePageHide = () => flushForPageLifecycle();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushForPageLifecycle();
    };

    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flushForPageLifecycle]);
}
