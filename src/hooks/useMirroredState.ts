import React from 'react';

export type MirroredStateSetter<T> = (next: T) => void;

export type UseMirroredStateResult<T> = readonly [T, MirroredStateSetter<T>, React.MutableRefObject<T>];

export function useMirroredState<T>(initial: T): UseMirroredStateResult<T> {
  const [value, setValue] = React.useState<T>(initial);
  const ref = React.useRef<T>(initial);
  const setMirrored = React.useCallback((next: T) => {
    ref.current = next;
    setValue(next);
  }, []);
  return [value, setMirrored, ref] as const;
}
