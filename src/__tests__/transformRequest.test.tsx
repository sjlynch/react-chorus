import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTransportLifecycle, type TransportLifecycleDeps } from '../hooks/assistant-session/transportLifecycle';
import type { ChorusTransformRequest } from '../hooks/useAssistantSession';
import { RESERVED_SYSTEM_PROMPT_ID } from '../reservedIds';
import type { Message } from '../types';

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
    transformRequestRef: { current: undefined },
    isAssistantSessionActive: vi.fn(() => true),
    invalidateAssistantSession: vi.fn(),
    removePendingAssistant: vi.fn(),
    setTransportBusy: vi.fn(),
    appendAssistantNow: vi.fn(),
    appendAssistantReasoningNow: vi.fn(),
    appendAssistantSourceNow: vi.fn(),
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

const USER_TURN: Message = { id: 'u1', role: 'user', text: 'tell me about the kraken' };

describe('useTransportLifecycle transformRequest', () => {
  it('fires the transformer once with reason "initial" before doStream', async () => {
    const transformer = vi.fn<ChorusTransformRequest<Record<string, unknown>>>(async () => undefined);
    const doStream = vi.fn(async () => undefined);
    const deps = createDeps({
      doStream,
      transformRequestRef: { current: transformer },
      systemPromptRef: { current: 'be helpful' },
    });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(7, 'tell me about the kraken', [USER_TURN], new AbortController(), 0);

    await waitFor(() => expect(doStream).toHaveBeenCalled());
    expect(transformer).toHaveBeenCalledTimes(1);
    const [ctx] = transformer.mock.calls[0]!;
    expect(ctx.reason).toBe('initial');
    expect(ctx.messages).toEqual([USER_TURN]);
    expect(ctx.systemPrompt).toBe('be helpful');
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
  });

  it('fires with reason "tool-continuation" for iteration > 0', async () => {
    const transformer = vi.fn<ChorusTransformRequest<Record<string, unknown>>>(async () => undefined);
    const deps = createDeps({ transformRequestRef: { current: transformer } });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(7, '', [USER_TURN], new AbortController(), 3);

    await waitFor(() => expect(transformer).toHaveBeenCalled());
    expect(transformer.mock.calls[0]![0].reason).toBe('tool-continuation');
  });

  it('replaces the wire history with transformer.result.messages', async () => {
    const lore: Message = { id: 'lore', role: 'system', text: 'The Kraken is a giant squid.' };
    const transformer = vi.fn<ChorusTransformRequest<Record<string, unknown>>>(async () => ({
      messages: [lore, USER_TURN],
    }));
    const doStream = vi.fn(async () => undefined);
    const deps = createDeps({ doStream, transformRequestRef: { current: transformer } });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(7, 'tell me', [USER_TURN], new AbortController(), 0);

    await waitFor(() => expect(doStream).toHaveBeenCalled());
    const [, history] = doStream.mock.calls[0]!;
    // No systemPrompt → no synthetic system row → history is exactly what the transformer returned.
    expect(history).toEqual([lore, USER_TURN]);
  });

  it('replaces the system prompt with transformer.result.systemPrompt and still prepends it', async () => {
    const transformer = vi.fn<ChorusTransformRequest<Record<string, unknown>>>(async () => ({
      systemPrompt: 'you are Captain Hook',
    }));
    const doStream = vi.fn(async () => undefined);
    const deps = createDeps({
      doStream,
      transformRequestRef: { current: transformer },
      systemPromptRef: { current: 'default' },
    });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(7, 'hi', [USER_TURN], new AbortController(), 0);

    await waitFor(() => expect(doStream).toHaveBeenCalled());
    const [, history] = doStream.mock.calls[0]!;
    expect(history[0]).toEqual({
      id: RESERVED_SYSTEM_PROMPT_ID,
      role: 'system',
      text: 'you are Captain Hook',
    });
    expect(history[1]).toEqual(USER_TURN);
  });

  it('routes transformer throws through the standard error finalizer', async () => {
    const failure = new Error('lorebook fetch failed');
    const transformer = vi.fn<ChorusTransformRequest<Record<string, unknown>>>(async () => {
      throw failure;
    });
    const doStream = vi.fn(async () => undefined);
    const deps = createDeps({ doStream, transformRequestRef: { current: transformer } });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(7, 'hi', [USER_TURN], new AbortController(), 0);

    await waitFor(() => expect(deps.observers.safeOnError).toHaveBeenCalledWith(failure));
    expect(deps.showStreamError).toHaveBeenCalledWith(failure);
    expect(deps.removePendingAssistant).toHaveBeenCalledTimes(1);
    expect(deps.invalidateAssistantSession).toHaveBeenCalledWith(7);
    expect(doStream).not.toHaveBeenCalled();
  });

  it('treats an abort during the transformer as silent (no onError / no banner)', async () => {
    const controller = new AbortController();
    const transformer = vi.fn<ChorusTransformRequest<Record<string, unknown>>>(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const deps = createDeps({ transformRequestRef: { current: transformer } });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(7, 'hi', [USER_TURN], controller, 0);

    await waitFor(() => expect(transformer).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.observers.safeOnError).not.toHaveBeenCalled();
    expect(deps.showStreamError).not.toHaveBeenCalled();
    expect(deps.setTransportBusy).toHaveBeenCalledWith(false);
  });

  it('skips the wire request if the session is no longer active when the transformer resolves', async () => {
    let resolved: () => void = () => undefined;
    const transformer = vi.fn<ChorusTransformRequest<Record<string, unknown>>>(() => new Promise(resolve => { resolved = () => resolve(undefined); }));
    const isActive = vi.fn(() => true);
    const doStream = vi.fn(async () => undefined);
    const deps = createDeps({
      doStream,
      transformRequestRef: { current: transformer },
      isAssistantSessionActive: isActive,
    });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(7, 'hi', [USER_TURN], new AbortController(), 0);
    await waitFor(() => expect(transformer).toHaveBeenCalled());
    isActive.mockReturnValue(false);
    resolved();

    await Promise.resolve();
    await Promise.resolve();
    expect(doStream).not.toHaveBeenCalled();
  });

  it('preserves systemPrompt when transformer omits the override', async () => {
    const transformer = vi.fn<ChorusTransformRequest<Record<string, unknown>>>(async () => ({}));
    const doStream = vi.fn(async () => undefined);
    const deps = createDeps({
      doStream,
      transformRequestRef: { current: transformer },
      systemPromptRef: { current: 'stay polite' },
    });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(7, 'hi', [USER_TURN], new AbortController(), 0);

    await waitFor(() => expect(doStream).toHaveBeenCalled());
    const [, history] = doStream.mock.calls[0]!;
    expect(history[0]).toEqual({
      id: RESERVED_SYSTEM_PROMPT_ID,
      role: 'system',
      text: 'stay polite',
    });
  });

  it('passes an empty-string systemPrompt override through as suppression for this request', async () => {
    const transformer = vi.fn<ChorusTransformRequest<Record<string, unknown>>>(async () => ({ systemPrompt: '' }));
    const doStream = vi.fn(async () => undefined);
    const deps = createDeps({
      doStream,
      transformRequestRef: { current: transformer },
      systemPromptRef: { current: 'stay polite' },
    });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(7, 'hi', [USER_TURN], new AbortController(), 0);

    await waitFor(() => expect(doStream).toHaveBeenCalled());
    const [, history] = doStream.mock.calls[0]!;
    expect(history).toEqual([USER_TURN]);
  });

  it('does not invoke the transformer when none is set (preserves the no-hook path)', async () => {
    const doStream = vi.fn(async () => undefined);
    const deps = createDeps({ doStream });
    const { result } = renderHook(() => useTransportLifecycle(deps));

    result.current.startTransportStream(7, 'hi', [USER_TURN], new AbortController(), 0);

    await waitFor(() => expect(doStream).toHaveBeenCalled());
  });
});
