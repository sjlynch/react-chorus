import type { Message } from '../../types';
import type { Transport } from '../useChorusStream';

// Keep the built-in string transport local to the widget path so the public
// react-chorus/transport subpath can stay free of hook/session chunks. This
// intentionally mirrors createFetchSSETransport's default request shape; sharing
// the tiny builder creates a static chunk edge that breaks the transport budget.
//
// Body shape: `history` already includes the latest user turn (`text` is a
// duplicate convenience copy). Backends should map `history` only. The duplicated
// `prompt` field is retained for backwards compatibility and is a candidate for
// removal in a future major release — see the `formatBody` JSDoc on
// `FetchSSETransportOptions` for the migration guidance, and keep this default
// in lockstep with `createFetchSSETransport` if it changes.
export function createDefaultFetchSSETransport<TMeta = Record<string, unknown>>(url: string): Transport<TMeta> {
  return async (text: string, history: Message<TMeta>[], signal: AbortSignal) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: text, history }),
    signal,
  });
}
