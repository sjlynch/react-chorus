import type { ConnectorResult } from '../types';
import type { OpenAIConnectorState } from '../openai';
import { warnOnceInDev } from '../../utils/warnings';
import { drainResponseRefusalText, drainResponseToolBuffer } from './responseToolCalls';
import { IGNORED_RESPONSE_EVENT_TYPES } from './responseMetadata';
import { handleResponseTerminalEvent } from './responseTerminalEvents';
import { handleResponseErrorEvent } from './responseErrorEvents';
import { handleResponseRefusalEvent } from './responseRefusalEvents';
import { handleResponseTextEvent } from './responseTextEvents';
import { handleResponseToolEvent } from './responseToolEvents';
import { handleResponseSourceEvent } from './responseSourceEvents';

// Re-exported so `openai.ts` (and the public `Connector` flush path) can drain
// orphan tool-call / refusal buffers without importing `responseToolCalls.ts`.
export { drainResponseToolBuffer, drainResponseRefusalText };

/** A focused handler for one Responses API event group: `(obj, state) => result | null`. */
type ResponseEventHandler = (obj: Record<string, unknown>, state: OpenAIConnectorState) => ConnectorResult | null;

/**
 * Dispatch table for the OpenAI Responses API (`response.*`) streaming
 * protocol — the file's at-a-glance map of every handled event type. Several
 * types share one handler because they form a single lifecycle (refusal
 * added/delta/done, the reasoning-delta variants, the tool-call
 * added/done/arguments events). Each handler lives in a sibling `response*Events.ts`
 * file and is a pure function of `(obj, state)`.
 *
 * Types absent here yield `null`; `IGNORED_RESPONSE_EVENT_TYPES` lifecycle
 * signals are filtered out by the dispatcher before this table is consulted.
 */
const RESPONSE_EVENT_HANDLERS: Record<string, ResponseEventHandler> = {
  // terminal / completion — see responseTerminalEvents.ts
  'response.completed': handleResponseTerminalEvent,
  'response.incomplete': handleResponseTerminalEvent,
  // failure / error — see responseErrorEvents.ts
  'response.failed': handleResponseErrorEvent,
  'response.error': handleResponseErrorEvent,
  // refusal lifecycle — see responseRefusalEvents.ts
  'response.refusal.added': handleResponseRefusalEvent,
  'response.refusal.delta': handleResponseRefusalEvent,
  'response.refusal.done': handleResponseRefusalEvent,
  // text / reasoning deltas — see responseTextEvents.ts
  'response.output_text.delta': handleResponseTextEvent,
  'response.reasoning_summary_text.delta': handleResponseTextEvent,
  'response.reasoning_text.delta': handleResponseTextEvent,
  'response.reasoning_summary.delta': handleResponseTextEvent,
  // output annotations / sources — see responseSourceEvents.ts
  'response.output_text.annotation.added': handleResponseSourceEvent,
  'response.output_text.done': handleResponseSourceEvent,
  // tool-call lifecycle — see responseToolEvents.ts
  'response.output_item.added': handleResponseToolEvent,
  'response.output_item.done': handleResponseToolEvent,
  'response.function_call_arguments.delta': handleResponseToolEvent,
};

/**
 * Thin dispatcher for the OpenAI Responses API (`response.*`) streaming
 * protocol. Filters out explicitly-ignored lifecycle events, then routes the
 * typed event to its focused handler via `RESPONSE_EVENT_HANDLERS`.
 *
 * An unknown `response.*` type (a new event added by OpenAI, a proxy that
 * leaks frames from a different protocol, or a typo in a custom backend) is
 * surfaced two ways instead of being silently dropped: a one-time dev console
 * warning keyed by the type, and a non-fatal `ConnectorWarning` so a host's
 * `onWarning` handler can record telemetry. The Responses API still adds new
 * `response.*` events (e.g. `response.web_search_call.*`,
 * `response.code_interpreter_call.*`); without this signal a rollout produces
 * silent regressions instead of an actionable warning.
 */
export function extractOpenAIResponseEvent(obj: Record<string, unknown>, state: OpenAIConnectorState): ConnectorResult | null {
  const type = typeof obj.type === 'string' ? obj.type : '';
  if (IGNORED_RESPONSE_EVENT_TYPES.has(type)) return null;
  const handler = RESPONSE_EVENT_HANDLERS[type];
  if (handler) return handler(obj, state);
  if (!type) return null;
  warnOnceInDev(
    `openai-responses-unknown-event:${type}`,
    `[react-chorus] OpenAI Responses connector received unknown event type "${type}". Add it to IGNORED_RESPONSE_EVENT_TYPES (responseMetadata.ts) if it should be skipped, or implement a handler and register it in RESPONSE_EVENT_HANDLERS (responses.ts).`,
  );
  return {
    warning: {
      code: 'unknown-event',
      message: `OpenAI Responses connector received unknown event type "${type}"`,
      payload: obj,
    },
  };
}
