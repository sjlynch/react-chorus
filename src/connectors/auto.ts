import { extractAutoConnectorData } from './auto/dispatch';
import {
  createAutoConnectorState,
  flushAutoConnectorState,
  type AutoConnectorState,
} from './auto/state';
import type { Connector } from './types';

/**
 * Auto connector:
 * - If data === "[DONE]" => { done: true }
 * - If data parses as JSON and is a Vercel AI SDK UI-message-stream event =>
 *   extract via aiSdkConnector. This dispatch runs before the generic in-band
 *   error check so an AI SDK frame carrying a stray top-level `error` key is
 *   parsed as its frame type, matching `aiSdkConnector.extract` (which parses
 *   typed frames first and only then falls back to error extraction).
 * - If data parses as JSON and carries an in-band provider error => { error }
 * - If data parses as JSON and looks like OpenAI Chat/Responses => extract text/reasoning/source/tool deltas
 * - If data parses as JSON and looks like Gemini => extract candidates text/reasoning/tool deltas
 * - If data parses as JSON and looks like Anthropic Messages => extract text/reasoning/tool deltas
 * - If data is genuinely a Vercel AI SDK data-stream line (`0:"..."`, `9:{...}`)
 *   => extract via aiSdkConnector. Plain model output that merely begins with
 *   `[a-z0-9]:` is not routed here — see `isAutoDataStreamFrame`.
 * - Else, delegate plain text to openaiConnector so `<think>...</think>` traces
 *   are routed into reasoning instead of rendered as visible answer text
 *
 * `flush()` is routed to whichever sub-connector first consumed the stream so a
 * connector-buffered tail is drained by the connector that parsed the stream.
 *
 * @internal Not part of the public API. Obtain it via `getConnector('auto')` or
 * `getConnector()` (auto is the default when no connector is specified).
 */
export const autoConnector: Connector<AutoConnectorState> = {
  name: 'auto',
  createState: createAutoConnectorState,
  extract(data: string, state = createAutoConnectorState()) {
    return extractAutoConnectorData(data, state);
  },
  flush(state = createAutoConnectorState()) {
    return flushAutoConnectorState(state);
  },
};
