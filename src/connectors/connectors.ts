import type { ConnectorName } from '../types';
import type { Connector } from './types';
import { openaiConnector, createOpenAIConnector, type OpenAIConnectorOptions } from './openai';
import { anthropicConnector } from './anthropic';
import { geminiConnector } from './gemini';
import { aiSdkConnector, isAiSdkFrameType } from './aiSdk';
import { DATA_STREAM_PREFIX_PATTERN } from './aiSdk/dataStream';
import { extractErrorMessage } from './error';

export type { Connector, ConnectorResult, ConnectorToolDelta, ConnectorWarning } from './types';
export { anthropicConnector } from './anthropic';
export { geminiConnector } from './gemini';
export { aiSdkConnector } from './aiSdk';
export { createOpenAIConnector, type OpenAIConnectorOptions } from './openai';

/** Sub-connector that parsed (consumed) frames on an `auto` stream. */
type AutoConsumer = 'openai' | 'anthropic' | 'gemini' | 'aiSdk';

interface AutoConnectorState {
  openai?: ReturnType<NonNullable<typeof openaiConnector.createState>>;
  anthropic?: ReturnType<NonNullable<typeof anthropicConnector.createState>>;
  gemini?: ReturnType<NonNullable<typeof geminiConnector.createState>>;
  aiSdk?: ReturnType<NonNullable<typeof aiSdkConnector.createState>>;
  /**
   * Sub-connector that first parsed a frame on this stream. `flush()` drains
   * the connector-buffered tail through this connector so an auto-detected
   * Anthropic / Gemini / AI SDK stream is flushed by the connector that
   * actually consumed it instead of always OpenAI.
   */
  consumedBy?: AutoConsumer;
}

const KNOWN_ANTHROPIC_EVENT_TYPES = new Set([
  'message_start',
  'message_delta',
  'message_stop',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'ping',
  'error',
]);

// `isAiSdkFrameType` (re-exported from `aiSdk.ts`) lists every UI-message-stream
// `type` value `aiSdkConnector` parses or intentionally ignores (including
// alias frames such as `tool-call-streaming-start` / `tool-call-delta`, the
// `data-*` wildcard, and `message-metadata`). Dispatching on it keeps explicit
// `connector="ai-sdk"` and default `connector="auto"` in sync so AI SDK
// lifecycle frames never fall through to raw-text rendering.

function genericJSONText(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const record = obj as Record<string, unknown>;
  for (const key of ['text', 'content', 'delta']) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  const delta = record.delta;
  if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
    const nested = delta as Record<string, unknown>;
    for (const key of ['text', 'content']) {
      const value = nested[key];
      if (typeof value === 'string' && value) return value;
    }
  }
  return null;
}

function createAutoConnectorState(): AutoConnectorState {
  return {
    openai: openaiConnector.createState?.(),
    anthropic: anthropicConnector.createState?.(),
    gemini: geminiConnector.createState?.(),
    aiSdk: aiSdkConnector.createState?.(),
  };
}

/** Record the first sub-connector to consume the stream; later frames keep it. */
function markConsumed(state: AutoConnectorState, consumer: AutoConsumer): void {
  if (!state.consumedBy) state.consumedBy = consumer;
}

/**
 * True when a non-JSON line is genuinely a Vercel AI SDK data-stream frame
 * (`0:"..."`, `9:{...}`, `e:{...}`) rather than plain model output that merely
 * begins with `[a-z0-9]:`.
 *
 * `connector="auto"` also serves plain-text streams, so the data-stream
 * dispatch must stay conservative:
 * - the line must match the `<prefix>:<rest>` shape, and
 * - `<rest>` must be valid JSON — prose like `a: example text` is not, so it
 *   falls through to plain-text rendering instead of being silently dropped, and
 * - for the `d:` / `e:` finish prefixes `<rest>` must be an object (the real
 *   finish-frame `{finishReason, usage}` shape) so a plain line such as `d:0`
 *   or `e:"note"` cannot terminate the stream early.
 *
 * An explicit `connector="ai-sdk"` opts into the protocol and needs no such
 * guard; this only tightens the auto path.
 */
function isAutoDataStreamFrame(data: string): boolean {
  const match = DATA_STREAM_PREFIX_PATTERN.exec(data);
  if (!match) return false;
  const prefix = match[1];
  const rest = match[2];
  if (prefix === undefined || rest === undefined) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rest);
  } catch {
    return false;
  }
  if (prefix === 'd' || prefix === 'e') {
    return parsed !== null && typeof parsed === 'object';
  }
  return true;
}

/**
 * Auto connector:
 * - If data === "[DONE]" => { done: true }
 * - If data parses as JSON and is a Vercel AI SDK UI-message-stream event =>
 *   extract via aiSdkConnector. This dispatch runs before the generic in-band
 *   error check so an AI SDK frame carrying a stray top-level `error` key is
 *   parsed as its frame type, matching `aiSdkConnector.extract` (which parses
 *   typed frames first and only then falls back to error extraction).
 * - If data parses as JSON and carries an in-band provider error => { error }
 * - If data parses as JSON and looks like OpenAI Chat/Responses => extract text/reasoning/tool deltas
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
    if (data === '[DONE]') return openaiConnector.extract(data, state.openai) ?? { done: true };
    try {
      const obj = JSON.parse(data);
      // Dispatch AI SDK typed frames before the generic error check: an AI SDK
      // frame with a stray top-level `error` key must be parsed as its frame
      // type here exactly as `aiSdkConnector` parses it, not turned into a
      // terminal stream error only on the `auto` path.
      if (obj && isAiSdkFrameType(obj.type)) {
        markConsumed(state, 'aiSdk');
        return aiSdkConnector.extract(data, state.aiSdk);
      }
      const error = extractErrorMessage(obj);
      if (error) return { error, errorPayload: obj };
      if (obj && Array.isArray(obj.choices)) {
        markConsumed(state, 'openai');
        return openaiConnector.extract(data, state.openai);
      }
      if (obj && Array.isArray(obj.candidates)) {
        markConsumed(state, 'gemini');
        return geminiConnector.extract(data, state.gemini);
      }
      if (obj && typeof obj.type === 'string' && obj.type.startsWith('response.')) {
        markConsumed(state, 'openai');
        return openaiConnector.extract(data, state.openai);
      }
      if (obj && typeof obj.type === 'string' && KNOWN_ANTHROPIC_EVENT_TYPES.has(obj.type)) {
        markConsumed(state, 'anthropic');
        return anthropicConnector.extract(data, state.anthropic);
      }
      const genericText = genericJSONText(obj);
      if (genericText) return { text: genericText };
    } catch {
      // Only commit a non-JSON line to the AI SDK data-stream parser when it is
      // genuinely a data-stream frame. Plain model output whose line happens to
      // start with `[a-z0-9]:` (e.g. `a: see below`, `d:0`) must fall through to
      // plain text rather than be dropped or terminate the stream early.
      if (isAutoDataStreamFrame(data)) {
        markConsumed(state, 'aiSdk');
        return aiSdkConnector.extract(data, state.aiSdk);
      }
      if (!data) return null;
      // Plain-text fallthrough: delegate to openaiConnector so DeepSeek-style
      // `<think>...</think>` traces are split into reasoning rather than rendered
      // verbatim. Per-stream think state lives in `state.openai`, so fragments
      // straddling chunk boundaries are preserved across calls.
      markConsumed(state, 'openai');
      return openaiConnector.extract(data, state.openai);
    }
    return data ? { text: data } : null;
  },
  flush(state = createAutoConnectorState()) {
    switch (state.consumedBy) {
      case 'anthropic':
        return anthropicConnector.flush?.(state.anthropic) ?? null;
      case 'gemini':
        return geminiConnector.flush?.(state.gemini) ?? null;
      case 'aiSdk':
        return aiSdkConnector.flush?.(state.aiSdk) ?? null;
      case 'openai':
      default:
        return openaiConnector.flush?.(state.openai) ?? null;
    }
  }
};

const VALID_CONNECTOR_NAMES = ['auto', 'openai', 'anthropic', 'gemini', 'ai-sdk'] as const;
const warnedUnknownConnectorNames = new Set<string>();
const warnedIgnoredOptionsConnectors = new Set<string>();

function isConnectorDevMode() {
  // Local to keep connector-only chunks independent from widget dev helpers.
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

/**
 * Warn (once per connector) when `getConnector` is handed options it cannot
 * apply. Only the `'openai'` string connector consumes the `options` argument;
 * for every other connector the argument is silently dropped, which is the
 * exact "dead option" footgun this guard surfaces in development.
 */
function warnIgnoredConnectorOptions(connector: Connector | ConnectorName | undefined) {
  if (!isConnectorDevMode()) return;
  const key = typeof connector === 'string' ? connector : connector ? `object:${connector.name}` : 'auto';
  if (warnedIgnoredOptionsConnectors.has(key)) return;
  warnedIgnoredOptionsConnectors.add(key);
  const target = typeof connector === 'string'
    ? `the \`${connector}\` connector`
    : connector
      ? 'a custom connector object'
      : 'the default `auto` connector';
  console.warn(`[Chorus] getConnector() received connector options, but ${target} does not accept them. Connector options currently only apply to \`getConnector('openai', ...)\` (or \`connector="openai"\` with \`connectorOptions\`).`);
}

/**
 * Resolve a connector. This is the single public way to obtain a built-in
 * connector: pass a name (`'auto'` | `'openai'` | `'anthropic'` | `'gemini'` |
 * `'ai-sdk'`) and Chorus returns the matching connector; pass a custom
 * `Connector` object and it is returned unchanged; pass nothing for the
 * auto-detecting connector.
 *
 * `options` customizes the resolved connector and is currently consumed only by
 * the `'openai'` connector (e.g. a custom `thinkTag` delimiter pair). It is
 * ignored — with a dev-mode warning — for every other connector.
 */
export function getConnector(connector?: Connector | ConnectorName, options?: OpenAIConnectorOptions): Connector {
  if (options && connector !== 'openai') warnIgnoredConnectorOptions(connector);
  if (!connector) return autoConnector;
  if (typeof connector === 'string') {
    if (connector === 'auto') return autoConnector;
    if (connector === 'openai') return options ? createOpenAIConnector(options) : openaiConnector;
    if (connector === 'anthropic') return anthropicConnector;
    if (connector === 'gemini') return geminiConnector;
    if (connector === 'ai-sdk') return aiSdkConnector;

    if (isConnectorDevMode() && !warnedUnknownConnectorNames.has(connector)) {
      warnedUnknownConnectorNames.add(connector);
      console.warn(`[Chorus] Unknown connector \`${connector}\`; falling back to \`auto\`. Valid connector names: ${VALID_CONNECTOR_NAMES.join(', ')}.`);
    }

    return autoConnector;
  }
  return connector;
}
