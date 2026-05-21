import type { ConnectorResult, ConnectorWarning } from '../../connectors/connectors';
import type { createDelayedChunkEmitter } from '../../streaming/delayedStreamEvents';
import { createConnectorStreamError } from '../../streaming/errors';
import type { createToolDeltaAccumulator } from '../../streaming/toolDeltaAccumulator';
import { warnInDev } from '../../streaming/internal/devMode';
import { safeOnObserverError } from './observer';
import type { SendCallbacks } from './types';

export type DelayedChunkEmitter = ReturnType<typeof createDelayedChunkEmitter>;
export type ToolDeltaAccumulator = ReturnType<typeof createToolDeltaAccumulator>;

/**
 * Deliver a non-fatal connector warning. When the host wired `onWarning`, the
 * warning is routed there; a throw is warned-and-ignored so it can never fail
 * an otherwise-successful send. Without an observer the warning is logged in
 * dev so the signal stays discoverable. The stream keeps flowing either way.
 */
function deliverConnectorWarning(cb: SendCallbacks, warning: ConnectorWarning) {
  if (cb.onWarning) {
    try {
      cb.onWarning(warning);
    } catch (callbackError) {
      safeOnObserverError('onWarning', callbackError);
    }
    return;
  }
  warnInDev(`[Chorus] connector warning (${warning.code}): ${warning.message}`, warning.payload);
}

/**
 * Deliver free-form connector metadata (usage, finish/stop reason, safety
 * ratings). When the host wired `onMetadata` the metadata is routed there; a
 * throw is warned-and-ignored so it can never fail an otherwise-successful
 * send. Unlike a warning, metadata without an observer is dropped silently —
 * it carries no diagnostic a developer needs surfaced, so dev-logging every
 * turn's finish reason would only be noise. The stream keeps flowing either way.
 */
function deliverConnectorMetadata(cb: SendCallbacks, metadata: Record<string, unknown>) {
  if (!cb.onMetadata) return;
  try {
    cb.onMetadata(metadata);
  } catch (callbackError) {
    safeOnObserverError('onMetadata', callbackError);
  }
}

function connectorErrorFromResult(out: ConnectorResult) {
  // Any present `error` field is a connector error — including `error: ''`. A
  // provider that emits an empty error string is still reporting a failure, so
  // a truthiness check would silently complete the stream with no error
  // surfaced. Use `'error' in out` as the sentinel so a missing key (no error)
  // stays distinct from a present-but-empty value.
  if (!('error' in out)) return null;
  // The error key is present but the message is empty/whitespace. Synthesize a
  // non-empty message so `streamRawError.message` and any `onError` handler
  // logging `error.message` never receive a blank string.
  const message = out.error?.trim() ? out.error : 'Connector reported an error with no message';
  return createConnectorStreamError(message, out.errorPayload);
}

export function createConnectorResultDeliverer(
  cb: SendCallbacks,
  delayedChunks: DelayedChunkEmitter,
  accumulateToolDelta: ToolDeltaAccumulator,
) {
  return (out: ConnectorResult | null | undefined): boolean => {
    if (!out) return false;

    const chunk = out.text || '';
    if (chunk) delayedChunks.handleChunk(chunk);

    const reasoning = out.reasoning || '';
    if (reasoning) delayedChunks.handleReasoning(reasoning);

    const toolDeltas = out.toolDeltas?.length ? out.toolDeltas : out.toolDelta ? [out.toolDelta] : [];
    for (const toolDelta of toolDeltas) delayedChunks.handleToolDelta(accumulateToolDelta(toolDelta));

    // Non-fatal connector signals (truncation, safety ratings, telemetry events). A single
    // chunk can carry several (`warnings`); the legacy single `warning` slot is the fallback
    // for connectors that emit only one. Each is routed to the optional onWarning observer;
    // without one they are logged in dev so they stay discoverable. The stream keeps flowing.
    const warnings = out.warnings?.length ? out.warnings : out.warning ? [out.warning] : [];
    for (const warning of warnings) deliverConnectorWarning(cb, warning);

    // Free-form provider metadata (usage, finish/stop reason, safety ratings). Routed to the
    // optional onMetadata observer; without one it is dropped silently. The stream continues.
    if (out.metadata) deliverConnectorMetadata(cb, out.metadata);

    const connectorError = connectorErrorFromResult(out);
    if (connectorError) throw connectorError;
    return Boolean(out.done);
  };
}
