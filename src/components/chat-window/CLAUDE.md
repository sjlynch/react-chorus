# chat-window guide

## Auto-scroll re-pinning

`useAutoScroll` keeps the transcript pinned to the bottom while
`shouldAutoScrollRef.current` is true. The `useLayoutEffect` keyed off
`activityKey` covers the common case where new content (a new message,
typing flip, error) re-renders the list. That key is intentionally
coarse — `activityKey` is derived from `messageActivityKey` outputs,
typing, streamingMessageId, and error — so it does **not** change when
the rendered height grows _after_ React has settled:

- a lazy `highlight.js` chunk loads and re-decorates a fenced code block
  in the final assistant message;
- an `<img>` attachment finishes loading and reports its intrinsic
  height;
- Markdown reflows after the sanitizer attaches.

To handle those post-settle growth paths, `useAutoScroll` also wires a
`ResizeObserver` that calls `repin()` (sets `scrollTop = scrollHeight`)
whenever:

1. the scroll container itself resizes (fluid layouts that grow with
   content), **or**
2. any direct child of the scroll container resizes (the more common
   fixed-height container case, where `scrollHeight` grows from child
   size changes).

A `MutationObserver` watches `childList` on the scroll container and
re-subscribes children when React adds/removes rows so the observer
keeps up with the rendered tree without needing a single content
wrapper.

Re-pinning is gated by `shouldAutoScrollRef.current`, so a user who
scrolled away still sees the jump-to-bottom button (via
`hasUnreadActivity`) instead of getting yanked back.

`onScroll` distinguishes scroll _direction_ via `lastScrollTopRef` (the
scrollTop at the end of the previous scroll event — content growth never
moves scrollTop, so it always equals scrollTop just before the current
event). Any user-originated **upward** scroll pauses pinning immediately,
even one smaller than `SCROLL_BOTTOM_THRESHOLD_PX`: during fast streaming
the resize-driven repin would otherwise re-pin every frame until the user
crossed 48px in a single gesture. The 48px threshold applies only to
**re-arming** — a downward gesture that lands back near the bottom
rejoins auto-scroll.

Every automatic pin (the `activityKey` layout effect and the
`ResizeObserver` repin) runs through `pinToBottom`, which arms a
`programmaticScrollRef` flag — but only when `scrollTop` actually moves,
so the flag is always consumed by the scroll event it produces and
never leaks onto a later genuine user scroll. The `onScroll` detector
skips the frame the flag is set for, so an auto-pin can't be misread as
the user re-joining the bottom while they are trying to scroll away.
The explicit `scrollToBottom` (Jump to latest) deliberately does **not**
set the flag: it is a user action, and its echoed scroll event simply
reaffirms the at-bottom state it already committed.

ResizeObserver / MutationObserver guards (`typeof X === 'undefined'`)
keep the hook SSR-safe and let jsdom-based tests opt in via stubs
without exploding when neither global is present.
