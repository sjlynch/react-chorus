import React from 'react';

const SCROLL_BOTTOM_THRESHOLD_PX = 48;

export function isNearBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD_PX;
}

export function useAutoScroll<TElement extends HTMLElement>(activityKey: string, forwardedRef: React.ForwardedRef<TElement>) {
  const windowRef = React.useRef<TElement>(null);
  const shouldAutoScrollRef = React.useRef(true);
  const previousActivityKeyRef = React.useRef(activityKey);
  // Set just before an automatic pin so the scroll event the browser fires in
  // response is not mistaken for the user choosing to leave/rejoin the bottom.
  const programmaticScrollRef = React.useRef(false);
  const [hasUnreadActivity, setHasUnreadActivity] = React.useState(false);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = React.useState(false);

  React.useImperativeHandle(forwardedRef, () => windowRef.current!);

  // Pin the transcript to the bottom for an automatic (non-user) reason. The
  // programmatic flag is only armed when scrollTop actually moves, so the very
  // scroll event it produces clears it again — a no-op pin never leaves a
  // stale flag that would swallow the user's next real scroll.
  const pinToBottom = React.useCallback(() => {
    const el = windowRef.current;
    if (!el) return;
    const before = el.scrollTop;
    el.scrollTop = el.scrollHeight;
    if (el.scrollTop !== before) programmaticScrollRef.current = true;
  }, []);

  const scrollToBottom = React.useCallback(() => {
    const el = windowRef.current;
    if (!el) return;
    // Jump-to-latest is an explicit user action: let the echoed scroll event
    // run through the detector normally — it simply reaffirms the at-bottom
    // state we set here, so it never needs programmatic suppression.
    el.scrollTop = el.scrollHeight;
    shouldAutoScrollRef.current = true;
    setIsAutoScrollPaused(false);
    setHasUnreadActivity(false);
  }, []);

  React.useEffect(() => {
    const el = windowRef.current;
    if (!el) return;

    const onScroll = () => {
      // Skip detection for the frame our own pin caused, so an auto-pin does
      // not re-arm auto-scroll after the user has deliberately scrolled away.
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
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
    pinToBottom();
  }, [activityKey, pinToBottom]);

  React.useEffect(() => {
    const el = windowRef.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') return;

    const repin = () => {
      // Never re-pin once the user has scrolled away; the jump-to-bottom
      // button (driven by hasUnreadActivity) is their way back instead.
      if (!shouldAutoScrollRef.current) return;
      if (!el.isConnected) return;
      pinToBottom();
    };

    const resizeObserver = new ResizeObserver(repin);

    const sync = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(el);
      for (const child of Array.from(el.children)) {
        if (child instanceof HTMLElement) resizeObserver.observe(child);
      }
    };

    sync();

    let mutationObserver: MutationObserver | undefined;
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(sync);
      mutationObserver.observe(el, { childList: true });
    }

    return () => {
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
    };
  }, [pinToBottom]);

  return {
    windowRef,
    hasUnreadActivity,
    isAutoScrollPaused,
    scrollToBottom,
  };
}
