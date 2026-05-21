import React from 'react';
import type { Transport } from '../useChorusStream';
import { warnInDev } from '../../utils/warnings';
import { createDefaultFetchSSETransport, type FetchTransportInit } from './transport';

const MISCONFIGURED_TRANSPORT_WARNING = '[Chorus] transport URL is empty/missing; assistant responses are disabled. '
  + 'Did you forget to set an env var or substitute a build-time placeholder?';

const MISCONFIGURED_TRANSPORT_ERROR = '[Chorus] transport is misconfigured: no usable URL was provided. Pass a '
  + 'non-empty URL string, or a transport object with a non-empty string `url`.';

export type AssistantSessionTransport<TMeta> = string | FetchTransportInit<TMeta> | Transport<TMeta> | undefined;

/**
 * Whether a `transport` prop is *present at all* — i.e. not `null`/`undefined`.
 *
 * The send pipeline (`send` command, `triggerAssistant`, the `sending`/`isBusy`
 * busy derivations) must select the transport-vs-`onSend` branch on this, NOT
 * on bare truthiness. The most common real misconfiguration is `transport=""`
 * — an unset env var or unsubstituted build-time placeholder resolving to an
 * empty string. That empty string is falsy, yet it is still a transport prop:
 * it must reach the rejecting transport `resolveAssistantSessionTransport`
 * builds for misconfigured URLs (Case 3) so the stream-error banner surfaces,
 * instead of being mistaken for an absent handler and producing the
 * "neither transport nor onSend" warning. `resolveAssistantSessionTransport`
 * itself treats only `null`/`undefined` as genuinely absent (Case 1), so the
 * resolver and the send pipeline stay in lockstep.
 */
export function isTransportPresent(transport: unknown): boolean {
  return transport != null;
}

export function resolveAssistantSessionTransport<TMeta>(transport: AssistantSessionTransport<TMeta>): Transport<TMeta> {
  // Case 1: transport genuinely absent — keep the silent empty-200 fallback.
  // This is the ONLY case for which that stub should remain reachable; an
  // absent transport means the caller is driving output some other way
  // (`onSend`, or not expecting assistant turns at all).
  if (transport == null) {
    return () => Promise.resolve(new Response(null, { status: 200 }));
  }

  // A custom Transport function is opaque to us; resolve it as-is.
  if (typeof transport === 'function') return transport;

  // String shorthand or `{ url }` object: require a usable, non-whitespace
  // URL before resolving. `transport.url` is typed `string`, but a JS caller
  // (unset env var, typo'd key, build-time placeholder) can still land here
  // with `undefined`/`''`, so the runtime checks below are load-bearing.
  const url = typeof transport === 'string' ? transport : transport.url;
  if (typeof url === 'string' && url.trim() !== '') {
    // Case 2: valid config — resolve normally.
    return createDefaultFetchSSETransport<TMeta>(transport);
  }

  // Case 3: transport is present but misconfigured — a bare empty/whitespace
  // string, or a non-null object lacking a usable string `url`. Do NOT fall
  // through to the empty-200 stub: that ends the turn with a blank assistant
  // message and no error. Warn in dev, and resolve to a transport that
  // rejects so the existing stream-error UI surfaces the misconfiguration.
  warnInDev(MISCONFIGURED_TRANSPORT_WARNING);
  return () => Promise.reject(new Error(MISCONFIGURED_TRANSPORT_ERROR));
}

export function useResolvedAssistantSessionTransport<TMeta>(transport: AssistantSessionTransport<TMeta>): Transport<TMeta> {
  return React.useMemo(() => resolveAssistantSessionTransport<TMeta>(transport), [transport]);
}
