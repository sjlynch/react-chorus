import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMirroredState } from '../hooks/useMirroredState';

describe('useMirroredState', () => {
  it('returns initial value, mirrored ref, and stable setter', () => {
    const { result } = renderHook(() => useMirroredState(false));
    const [value, setMirrored, ref] = result.current;
    expect(value).toBe(false);
    expect(ref.current).toBe(false);
    expect(typeof setMirrored).toBe('function');
  });

  it('keeps ref in sync synchronously and re-renders with new state', () => {
    const { result } = renderHook(() => useMirroredState(0));
    const initialRef = result.current[2];
    const initialSetter = result.current[1];

    act(() => { result.current[1](7); });

    expect(result.current[0]).toBe(7);
    expect(result.current[2].current).toBe(7);
    // ref identity should be preserved across renders
    expect(result.current[2]).toBe(initialRef);
    // setter identity should be stable across renders for useCallback deps
    expect(result.current[1]).toBe(initialSetter);
  });

  it('updates ref before commit so synchronous reads see the latest value', () => {
    const { result } = renderHook(() => useMirroredState('a'));
    const [, setMirrored, ref] = result.current;

    act(() => {
      setMirrored('b');
      // inside the same tick, the ref should already reflect the new value
      expect(ref.current).toBe('b');
    });

    expect(result.current[0]).toBe('b');
    expect(result.current[2].current).toBe('b');
  });

  it('supports arbitrary value types', () => {
    type S = { count: number };
    const { result } = renderHook(() => useMirroredState<S>({ count: 1 }));
    const next: S = { count: 5 };

    act(() => { result.current[1](next); });

    expect(result.current[0]).toBe(next);
    expect(result.current[2].current).toBe(next);
  });
});
