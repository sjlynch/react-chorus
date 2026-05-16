import React from 'react';

const SCROLL_BOTTOM_THRESHOLD_PX = 48;

export function isNearBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD_PX;
}

export function useAutoScroll<TElement extends HTMLElement>(activityKey: string, forwardedRef: React.ForwardedRef<TElement>) {
  const windowRef = React.useRef<TElement>(null);
  const shouldAutoScrollRef = React.useRef(true);
  const previousActivityKeyRef = React.useRef(activityKey);
  const [hasUnreadActivity, setHasUnreadActivity] = React.useState(false);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = React.useState(false);

  React.useImperativeHandle(forwardedRef, () => windowRef.current!);

  const scrollToBottom = React.useCallback(() => {
    const el = windowRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    shouldAutoScrollRef.current = true;
    setIsAutoScrollPaused(false);
    setHasUnreadActivity(false);
  }, []);

  React.useEffect(() => {
    const el = windowRef.current;
    if (!el) return;

    const onScroll = () => {
      const nearBottom = isNearBottom(el);
      shouldAutoScrollRef.current = nearBottom;
      setIsAutoScrollPaused(!nearBottom);
      if (nearBottom) setHasUnreadActivity(false);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  React.useEffect(() => {
    if (previousActivityKeyRef.current === activityKey) return;

    if (!shouldAutoScrollRef.current) setHasUnreadActivity(true);
    previousActivityKeyRef.current = activityKey;
  }, [activityKey]);

  React.useLayoutEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    const el = windowRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activityKey]);

  return {
    windowRef,
    hasUnreadActivity,
    isAutoScrollPaused,
    scrollToBottom,
  };
}
