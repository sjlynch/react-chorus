import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLatestRef } from '../hooks/useLatestRef';

describe('useLatestRef', () => {
  it('returns a ref initialized to the current value', () => {
    const { result } = renderHook(({ value }) => useLatestRef(value), {
      initialProps: { value: 'a' },
    });
    expect(result.current.current).toBe('a');
  });

  it('updates ref.current during render — not one render late', () => {
    const seenDuringRender: string[] = [];
    const { result, rerender } = renderHook(
      ({ value }) => {
        const ref = useLatestRef(value);
        // Read inside render: a passive-effect implementation would still hold
        // the previous value here, so the latest prop would land one render late.
        seenDuringRender.push(ref.current);
        return ref;
      },
      { initialProps: { value: 'a' } },
    );

    expect(seenDuringRender).toEqual(['a']);

    rerender({ value: 'b' });
    expect(seenDuringRender).toEqual(['a', 'b']);
    expect(result.current.current).toBe('b');

    rerender({ value: 'c' });
    expect(seenDuringRender).toEqual(['a', 'b', 'c']);
    expect(result.current.current).toBe('c');
  });

  it('keeps a stable ref object across renders', () => {
    const { result, rerender } = renderHook(({ value }) => useLatestRef(value), {
      initialProps: { value: 1 },
    });
    const firstRef = result.current;

    rerender({ value: 2 });

    expect(result.current).toBe(firstRef);
    expect(result.current.current).toBe(2);
  });

  it('exposes the latest value to a stable callback created in the same render', () => {
    const { result, rerender } = renderHook(
      ({ value }) => {
        const ref = useLatestRef(value);
        // A stable-identity reader closing over the ref — the documented use
        // case: stable callbacks/async closures reading current props/state.
        return React.useCallback(() => ref.current, [ref]);
      },
      { initialProps: { value: 'first' } },
    );

    const read = result.current;
    rerender({ value: 'second' });

    expect(read()).toBe('second');
  });
});
