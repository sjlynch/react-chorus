import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTransportLifecycle, type TransportLifecycleDeps } from '../hooks/assistant-session/transportLifecycle';
import { ChorusStreamError } from '../streaming/errors';

type Deps = TransportLifecycleDeps<Record<string, unknown>>;

function createDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    controllerRef: { current: null },
    messagesRef: { current: [] },
    pendingToolMessageIdsRef: { current: new Set() },
    autoContinueToolsRef: { current: false },
    maxToolIterationsRef: { current: 4 },
    shouldContinueToolLoopRef: { current: undefined },
    systemPromptRef: { current: undefined },
    minAssistantDelayMsRef: { current: 0 },
    isAssistantSessionActive: vi.fn(() => true),
    invalidateAssistantSession: vi.fn(),
    removePendingAssistant: vi.fn(),
    setTransportBusy: vi.fn(),
    appendAssistantNow: vi.fn(),
    appendAssistantReasoningNow: vi.fn(),
    appendToolDeltaNow: vi.fn(),
    finalizeAssistantNow: vi.fn(() => null),
    resetPendingAssistantState: vi.fn(),
    getToolMessagesByIds: vi.fn(() => []),
    runCompletedToolCalls: vi.fn(async () => undefined),
    showStreamError: vi.fn(),
    observers: {
      safeOnError: vi.fn(),
      safeOnFinish: vi.fn(),
      safeOnStreamDone: vi.fn(),
      safeOnStreamWarning: vi.fn(),
      safeOnStreamMetadata: vi.fn(),
    },
    doStream: vi.fn(async () => undefined),
    forceRender: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useTransportLifecycle startTransportStream rejection handling', () => {
  it('surfaces a concurrent-send rejection instead of silently swallowing the turn', async () => {
    // A continuation startTransportStream racing a user send leaves useChorusStream's
    // isSendingRef set, so the second doStream rejects with `concurrent-send`. Before
    // the fix the bare `.catch` released busy state and the turn vanished with no error.
    const rejection = new ChorusStreamError('overlapping send', { code: 'concurrent-send' });
    const deps = createDeps({ doStream: vi.fn(async () => { throw rejection; }) });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(7, 'hi', [], new AbortController(), 0);

    await waitFor(() => expect(deps.showStreamError).toHaveBeenCalledWith(rejection));
    expect(deps.observers.safeOnError).toHaveBeenCalledWith(rejection);
    expect(deps.removePendingAssistant).toHaveBeenCalledTimes(1);
    expect(deps.invalidateAssistantSession).toHaveBeenCalledWith(7);
    expect(deps.setTransportBusy).toHaveBeenCalledWith(false);
  });

  it('surfaces an already-aborted rejection the same way', async () => {
    const rejection = new ChorusStreamError('signal already aborted', { code: 'already-aborted' });
    const deps = createDeps({ doStream: vi.fn(async () => { throw rejection; }) });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(1, 'hi', [], new AbortController(), 0);

    await waitFor(() => expect(deps.observers.safeOnError).toHaveBeenCalledWith(rejection));
    expect(deps.showStreamError).toHaveBeenCalledWith(rejection);
    expect(deps.removePendingAssistant).toHaveBeenCalledTimes(1);
  });

  it('does not surface a stale concurrent-send rejection once the session is no longer active', async () => {
    const rejection = new ChorusStreamError('overlapping send', { code: 'concurrent-send' });
    const deps = createDeps({
      isAssistantSessionActive: vi.fn(() => false),
      doStream: vi.fn(async () => { throw rejection; }),
    });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(1, 'hi', [], new AbortController(), 0);

    await waitFor(() => expect(deps.doStream).toHaveBeenCalled());
    await Promise.resolve();
    expect(deps.showStreamError).not.toHaveBeenCalled();
    expect(deps.observers.safeOnError).not.toHaveBeenCalled();
  });

  it('still silently releases busy state for a generic rejection without surfacing an error', async () => {
    // Genuine stream/HTTP errors already reach the user through the cb.onError path,
    // so a bare rejection here must not double-report — it only releases the controller.
    const deps = createDeps({ doStream: vi.fn(async () => { throw new Error('network down'); }) });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(1, 'hi', [], new AbortController(), 0);

    await waitFor(() => expect(deps.setTransportBusy).toHaveBeenCalledWith(false));
    expect(deps.showStreamError).not.toHaveBeenCalled();
    expect(deps.observers.safeOnError).not.toHaveBeenCalled();
    expect(deps.removePendingAssistant).not.toHaveBeenCalled();
  });
});
