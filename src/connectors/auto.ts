import { anthropicConnector } from './anthropic';
import { aiSdkConnector, isAiSdkFrameType } from './aiSdk';
import { DATA_STREAM_PREFIX_PATTERN } from './aiSdk/dataStream';
import { extractErrorMessage } from './error';
import { geminiConnector } from './gemini';
import { openaiConnector } from './openai';
import type { Connector } from './types';

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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOpenAIChatShape(value: unknown): boolean {
  return isObjectRecord(value) && Array.isArray(value.choices);
}

function hasGeminiCandidateShape(value: unknown): boolean {
  return isObjectRecord(value) && Array.isArray(value.candidates);
}

function hasOpenAIResponseShape(value: unknown): boolean {
  return isObjectRecord(value) && typeof value.type === 'string' && value.type.startsWith('response.');
}

function hasAnthropicEventShape(value: unknown): boolean {
  return isObjectRecord(value) && typeof value.type === 'string' && KNOWN_ANTHROPIC_EVENT_TYPES.has(value.type);
}

function hasAiSdkUiMessageShape(value: unknown): boolean {
  return isObjectRecord(value) && isAiSdkFrameType(value.type);
}

function genericJSONText(obj: unknown): string | null {
  if (!isObjectRecord(obj)) return null;
  for (const key of ['text', 'content', 'delta']) {
    const value = obj[key];
    if (typeof value === 'string' && value) return value;
  }
  const delta = obj.delta;
  if (isObjectRecord(delta)) {
    for (const key of ['text', 'content']) {
      const value = delta[key];
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
      if (hasAiSdkUiMessageShape(obj)) {
        markConsumed(state, 'aiSdk');
        return aiSdkConnector.extract(data, state.aiSdk);
      }
      const error = extractErrorMessage(obj);
      if (error) return { error, errorPayload: obj };
      if (hasOpenAIChatShape(obj)) {
        markConsumed(state, 'openai');
        return openaiConnector.extract(data, state.openai);
      }
      if (hasGeminiCandidateShape(obj)) {
        markConsumed(state, 'gemini');
        return geminiConnector.extract(data, state.gemini);
      }
      if (hasOpenAIResponseShape(obj)) {
        markConsumed(state, 'openai');
        return openaiConnector.extract(data, state.openai);
      }
      if (hasAnthropicEventShape(obj)) {
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
  },
};
