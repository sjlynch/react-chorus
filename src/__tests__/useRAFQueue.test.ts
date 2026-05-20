import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRAFQueue } from '../hooks/useRAFQueue';

describe('useRAFQueue', () => {
  let rafCallbacks: FrameRequestCallback[];
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Capture RAF callbacks without firing them, so tests control exactly when
    // (or whether) the queued flush runs.
    rafCallbacks = [];
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  const fireRAF = () => {
    const pending = rafCallbacks.slice();
    rafCallbacks.length = 0;
    pending.forEach(cb => cb(performance.now()));
  };

  it('flushes queued chunks to the callback when the RAF fires', () => {
    const flush = vi.fn();
    const { result } = renderHook(() => useRAFQueue(flush));

    act(() => { result.current.enqueue('foo'); });
    act(() => { result.current.enqueue('bar'); });
    expect(flush).not.toHaveBeenCalled();

    act(() => { fireRAF(); });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('foobar');
  });

  it('flushes pending chunks on unmount instead of discarding them', () => {
    const flush = vi.fn();
    const { result, unmount } = renderHook(() => useRAFQueue(flush));

    // Enqueue a chunk; the RAF is scheduled but never fired.
    act(() => { result.current.enqueue('mid-token'); });
    expect(flush).not.toHaveBeenCalled();

    // Unmounting before the RAF fires must hand the queued chunk to the
    // registered updater rather than dropping it (regression: cleanup used to
    // call cancelPending(false), leaving the transcript ending mid-token).
    unmount();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('mid-token');
    // The scheduled frame is also cancelled so it cannot double-flush later.
    expect(cafSpy).toHaveBeenCalled();
  });

  it('does not invoke the callback on unmount when nothing is queued', () => {
    const flush = vi.fn();
    const { unmount } = renderHook(() => useRAFQueue(flush));

    unmount();

    expect(flush).not.toHaveBeenCalled();
  });

  it('does not double-flush a chunk that already drained before unmount', () => {
    const flush = vi.fn();
    const { result, unmount } = renderHook(() => useRAFQueue(flush));

    act(() => { result.current.enqueue('done'); });
    act(() => { fireRAF(); });
    expect(flush).toHaveBeenCalledTimes(1);

    unmount();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('cancelPending(true) flushes the queue synchronously', () => {
    const flush = vi.fn();
    const { result } = renderHook(() => useRAFQueue(flush));

    act(() => { result.current.enqueue('sync'); });
    act(() => { result.current.cancelPending(true); });

    expect(flush).toHaveBeenCalledWith('sync');
  });

  it('cancelPending(false) discards the queue without flushing', () => {
    const flush = vi.fn();
    const { result } = renderHook(() => useRAFQueue(flush));

    act(() => { result.current.enqueue('drop'); });
    act(() => { result.current.cancelPending(false); });

    expect(flush).not.toHaveBeenCalled();
    // Queue is empty, so a subsequent RAF has nothing to deliver.
    act(() => { fireRAF(); });
    expect(flush).not.toHaveBeenCalled();
  });
});
