import type { Connector, ConnectorToolDelta, ConnectorWarning } from '../../connectors/connectors';
import type { OpenAIConnectorOptions } from '../../connectors/openai';
import type { ConnectorName, Message } from '../../types';

export interface SendCallbacks {
  /**
   * Optional notification fired once when the first stream event of any kind is
   * delivered — text, reasoning, or a tool-call delta. This fires even for
   * reasoning-first or tool-only turns that never emit answer text, so it is a
   * reliable signal to clear a thinking placeholder or mark the assistant
   * message live. `firstChunk` carries the first text chunk when that first
   * event is text (the same chunk is also delivered to onChunk); for a
   * reasoning- or tool-first turn it is an empty string.
   */
  onStart?: (firstChunk: string) => void;
  /** Receives every non-empty text stream chunk, including the first one. */
  onChunk: (chunk: string) => void;
  /** Receives non-empty reasoning/thinking chunks when the connector exposes them. */
  onReasoning?: (chunk: string) => void;
  /** Receives accumulated tool-call deltas when the connector exposes them. */
  onToolDelta?: (toolDelta: ConnectorToolDelta) => void;
  /**
   * Receives non-fatal connector warnings (truncation, safety ratings, telemetry) as the
   * connector emits them. Unlike onError, a warning does not abort the stream — delivery
   * continues after the callback returns. If this callback throws, the error is warned in
   * development and otherwise ignored, so a misbehaving warning observer cannot fail an
   * otherwise-successful send.
   */
  onWarning?: (warning: ConnectorWarning) => void;
  /**
   * Called after a successful stream completes. If this callback throws, send() rejects
   * with that callback error; onError is not invoked because no stream error occurred.
   */
  onDone?: (response?: Response) => void;
  /**
   * Called for non-abort stream errors. If this callback throws while handling an
   * error, the callback error is warned in development and send() still rejects
   * with the original stream error.
   */
  onError?: (err: Error) => void;
  /** Minimum elapsed time from send() start before delivering the first chunk. */
  minDelayMs?: number;
}

export type Transport<TMeta = Record<string, unknown>> = (text: string, history: Message<TMeta>[], signal: AbortSignal) => Promise<Response>;

export interface StreamOptions {
  connector?: Connector | ConnectorName;
  /**
   * Options forwarded to the built-in connector resolved from a `connector`
   * string. Currently only the `'openai'` connector consumes options (e.g. a
   * custom `thinkTag` delimiter pair). Ignored when `connector` is a custom
   * `Connector` object — build that object with `createOpenAIConnector(options)`.
   */
  connectorOptions?: OpenAIConnectorOptions;
}
