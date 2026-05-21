import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDelayedChunkEmitter } from '../streaming/delayedStreamEvents';

// ---------------------------------------------------------------------------

describe('createDelayedChunkEmitter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('delays queued event delivery and fires onStart once for the first delivered event', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const emitter = createDelayedChunkEmitter({
      minDelayMs: 100,
      onStart: chunk => calls.push(`start:${chunk}`),
      onChunk: chunk => calls.push(`text:${chunk}`),
      onReasoning: chunk => calls.push(`reasoning:${chunk}`),
      onToolDelta: toolDelta => calls.push(`tool:${toolDelta.id}`),
    }, Date.now(), controller.signal);

    emitter.handleReasoning('plan');
    emitter.handleToolDelta({ id: 'call_1' });
    emitter.handleChunk('answer');

    await vi.advanceTimersByTimeAsync(99);
    expect(calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    await emitter.flushBeforeDone();

    expect(calls).toEqual([
      'start:',
      'reasoning:plan',
      'tool:call_1',
      'text:answer',
    ]);
  });

  it('clears buffered events when aborted before the min-delay timer releases', async () => {
    const controller = new AbortController();
    const onStart = vi.fn();
    const onChunk = vi.fn();
    const emitter = createDelayedChunkEmitter({
      minDelayMs: 100,
      onStart,
      onChunk,
    }, Date.now(), controller.signal);

    emitter.handleChunk('token');
    controller.abort();

    await expect(emitter.flushBeforeDone()).rejects.toMatchObject({ name: 'AbortError' });
    await vi.runAllTimersAsync();

    expect(onStart).not.toHaveBeenCalled();
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('propagates callback errors thrown during delayed timer delivery', async () => {
    const controller = new AbortController();
    const callbackError = new Error('chunk observer failed');
    const emitter = createDelayedChunkEmitter({
      minDelayMs: 50,
      onChunk: () => { throw callbackError; },
    }, Date.now(), controller.signal);

    emitter.handleChunk('token');
    const callbackRejection = expect(emitter.callbackErrorPromise).rejects.toBe(callbackError);

    await vi.advanceTimersByTimeAsync(50);
    await callbackRejection;

    await expect(emitter.flushBeforeDone()).rejects.toBe(callbackError);
    expect(emitter.getCallbackError()).toBe(callbackError);
  });
});
