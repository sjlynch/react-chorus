import React from 'react';
import { useLatestRef } from '../useLatestRef';

export interface SessionBusyDeps {
  transport: unknown;
  transportRef: React.MutableRefObject<unknown>;
  streamSending: boolean;
  transportBusy: boolean;
  transportBusyRef: React.MutableRefObject<boolean>;
  internalSending: boolean;
  internalSendingRef: React.MutableRefObject<boolean>;
}

export interface SessionBusyState {
  sending: boolean;
  isBusy: () => boolean;
}

/** Derive public/built-in busy state while preserving transport-vs-onSend gating. */
export function useSessionBusy({
  transport,
  transportRef,
  streamSending,
  transportBusy,
  transportBusyRef,
  internalSending,
  internalSendingRef,
}: SessionBusyDeps): SessionBusyState {
  const streamSendingRef = useLatestRef(streamSending);
  const sending = transport ? (streamSending || transportBusy) : internalSending;

  const isBusy = React.useCallback(() => (
    transportRef.current
      ? streamSendingRef.current || transportBusyRef.current
      : internalSendingRef.current
  ), [internalSendingRef, streamSendingRef, transportBusyRef, transportRef]);

  return { sending, isBusy };
}
