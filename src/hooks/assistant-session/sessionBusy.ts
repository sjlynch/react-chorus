import React from 'react';
import { useLatestRef } from '../useLatestRef';
import { isTransportPresent } from './transportResolver';

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
  // Gate on transport *presence*, not bare truthiness, so a misconfigured
  // `transport=""` reports transport busy state (matching the transport send
  // path) instead of falling back to the `onSend`-only `internalSending`.
  const sending = isTransportPresent(transport) ? (streamSending || transportBusy) : internalSending;

  const isBusy = React.useCallback(() => (
    isTransportPresent(transportRef.current)
      ? streamSendingRef.current || transportBusyRef.current
      : internalSendingRef.current
  ), [internalSendingRef, streamSendingRef, transportBusyRef, transportRef]);

  return { sending, isBusy };
}
