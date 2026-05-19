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

ResizeObserver / MutationObserver guards (`typeof X === 'undefined'`)
keep the hook SSR-safe and let jsdom-based tests opt in via stubs
without exploding when neither global is present.
