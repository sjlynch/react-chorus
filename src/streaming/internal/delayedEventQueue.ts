import type { MessageSource } from '../../types';
import type { ConnectorToolDelta } from '../../connectors/types';
import { createAbortError } from './streamErrors';
import type { ReleaseSchedule } from './delayedReleaseSchedule';

export type DelayedStreamEvent =
  | { type: 'text'; chunk: string }
  | { type: 'reasoning'; chunk: string }
  | { type: 'source'; source: MessageSource }
  | { type: 'toolDelta'; toolDelta: ConnectorToolDelta };

export function isEmptyChunkEvent(event: DelayedStreamEvent): boolean {
  return (event.type === 'text' || event.type === 'reasoning') && !event.chunk;
}

export function createDelayedEventQueue() {
  let events: DelayedStreamEvent[] = [];

  return {
    push(event: DelayedStreamEvent) {
      events.push(event);
    },
    drain() {
      const drained = events;
      events = [];
      return drained;
    },
    clear() {
      events = [];
    },
    get hasEvents() {
      return events.length > 0;
    },
  };
}

export type DelayedEventQueue = ReturnType<typeof createDelayedEventQueue>;

export function createAbortCancellation(queue: DelayedEventQueue) {
  let cancelled = false;

  const cancelBufferedWork = () => {
    cancelled = true;
    queue.clear();
  };

  return {
    get cancelled() {
      return cancelled;
    },
    cancelBufferedWork,
    cancelRelease(release: ReleaseSchedule) {
      cancelBufferedWork();
      release.rejectWith(createAbortError());
    },
    throwIfCancelled() {
      if (cancelled) throw createAbortError();
    },
  };
}

export type AbortCancellation = ReturnType<typeof createAbortCancellation>;
