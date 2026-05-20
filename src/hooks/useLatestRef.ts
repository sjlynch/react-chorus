import React from 'react';

export function useLatestRef<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);
  // Assign during render so `ref.current` is the latest value immediately —
  // including during this render and in synchronous callbacks fired in the
  // same commit. A passive effect would update it one render late, so a
  // `send()` triggered in the same render as a prop change would read the
  // previous value (e.g. dispatch to the previous `transport` endpoint).
  ref.current = value;
  return ref;
}
