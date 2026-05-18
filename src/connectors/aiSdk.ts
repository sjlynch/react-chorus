import { warnOnceInDev } from '../utils/warnings';
import { extractErrorMessage } from './error';
import type { Connector, ConnectorResult, ConnectorToolDelta } from './types';

export interface AiSdkConnectorState {
  toolNamesById: Map<string, string>;
}

export function createAiSdkConnectorState(): AiSdkConnectorState {
  return { toolNamesById: new Map<string, string>() };
}

function resetAiSdkState(state: AiSdkConnectorState) {
  state.toolNamesById.clear();
}

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function warnMissingToolCallId(frameType: string) {
  warnOnceInDev(
    `ai-sdk:${frameType}:missing-toolCallId`,
    `[Chorus] AI SDK ${frameType} frame is missing required field \`toolCallId\`; the tool fragment was dropped. Ensure every tool frame includes a \`toolCallId\`.`,
  );
}

function toolDeltaFromToolCall(
  state: AiSdkConnectorState,
  frameType: string,
  toolCallId: unknown,
  toolName: unknown,
  args: unknown,
  hasArgs: boolean,
): ConnectorToolDelta | null {
  const explicitId = typeof toolCallId === 'string' && toolCallId ? toolCallId : undefined;
  if (!explicitId) {
    warnMissingToolCallId(frameType);
    return null;
  }
  const name = typeof toolName === 'string' && toolName ? toolName : state.toolNamesById.get(explicitId);
  if (name) state.toolNamesById.set(explicitId, name);
  const delta: ConnectorToolDelta = { id: explicitId, providerId: explicitId };
  if (name) delta.name = name;
  if (hasArgs) delta.input = args;
  return delta;
}

function toolDeltaFromToolResult(
  state: AiSdkConnectorState,
  frameType: string,
  toolCallId: unknown,
  output: unknown,
): ConnectorToolDelta | null {
  const explicitId = typeof toolCallId === 'string' && toolCallId ? toolCallId : undefined;
  if (!explicitId) {
    warnMissingToolCallId(frameType);
    return null;
  }
  const delta: ConnectorToolDelta = { id: explicitId, providerId: explicitId, output };
  const name = state.toolNamesById.get(explicitId);
  if (name) delta.name = name;
  return delta;
}

// Vercel AI SDK UI-message-stream `type` values that `aiSdkConnector` either
// parses or intentionally ignores. Exported so `autoConnector` can delegate
// every recognised frame to the AI SDK path without duplicating the list.
const AI_SDK_FRAME_TYPES = new Set([
  // Parsed by uiMessageStreamResult.
  'text-delta',
  'text',
  'reasoning-delta',
  'reasoning',
  'tool-input-start',
  'tool-call-streaming-start',
  'tool-input-delta',
  'tool-call-delta',
  'tool-input-available',
  'tool-call',
  'tool-output-available',
  'tool-result',
  'error',
  'finish',
  'finish-message',
  // Intentionally ignored (lifecycle / non-text payloads) — still claimed so
  // autoConnector does not render them as raw protocol JSON.
  'start',
  'start-step',
  'finish-step',
  'text-start',
  'text-end',
  'reasoning-start',
  'reasoning-end',
  'source-url',
  'source-document',
  'file',
  'message-metadata',
]);

/**
 * True when `type` is a Vercel AI SDK UI-message-stream frame this connector
 * parses or intentionally ignores. `autoConnector` uses this so every AI SDK
 * frame (including data-`*` wildcards and lifecycle-only frames) is delegated
 * to the AI SDK path instead of falling through to raw-text rendering.
 */
export function isAiSdkFrameType(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  return AI_SDK_FRAME_TYPES.has(type) || type.startsWith('data-');
}

function uiMessageStreamResult(state: AiSdkConnectorState, obj: Record<string, unknown>, raw: unknown): ConnectorResult | null {
  const type = obj.type;
  if (typeof type !== 'string') return null;

  if (type === 'text-delta' || type === 'text') {
    const delta = obj.delta ?? obj.text;
    return typeof delta === 'string' && delta ? { text: delta } : null;
  }

  if (type === 'reasoning-delta' || type === 'reasoning') {
    const delta = obj.delta ?? obj.text;
    return typeof delta === 'string' && delta ? { reasoning: delta } : null;
  }

  if (type === 'tool-input-start' || type === 'tool-call-streaming-start') {
    const toolDelta = toolDeltaFromToolCall(state, type, obj.toolCallId, obj.toolName, undefined, false);
    return toolDelta ? { toolDelta } : null;
  }

  if (type === 'tool-input-delta' || type === 'tool-call-delta') {
    const fragment = obj.inputTextDelta ?? obj.argsTextDelta;
    if (typeof fragment !== 'string' || fragment === '') return null;
    const toolDelta = toolDeltaFromToolCall(state, type, obj.toolCallId, obj.toolName, fragment, true);
    return toolDelta ? { toolDelta } : null;
  }

  if (type === 'tool-input-available' || type === 'tool-call') {
    const input = obj.input ?? obj.args;
    const hasArgs = hasOwn(obj, 'input') || hasOwn(obj, 'args');
    const toolDelta = toolDeltaFromToolCall(state, type, obj.toolCallId, obj.toolName, input, hasArgs);
    return toolDelta ? { toolDelta } : null;
  }

  if (type === 'tool-output-available' || type === 'tool-result') {
    const output = obj.output ?? obj.result;
    const toolDelta = toolDeltaFromToolResult(state, type, obj.toolCallId, output);
    return toolDelta ? { toolDelta } : null;
  }

  if (type === 'error') {
    const message = typeof obj.errorText === 'string' && obj.errorText
      ? obj.errorText
      : extractErrorMessage(obj) ?? 'AI SDK stream reported an error';
    return { error: message, errorPayload: raw };
  }

  if (type === 'finish' || type === 'finish-message') {
    resetAiSdkState(state);
    return { done: true };
  }

  // Frames we deliberately ignore: start, start-step, finish-step, text-start, text-end,
  // reasoning-start, reasoning-end, source-url, source-document, file, data-*, message-metadata.
  return null;
}

const DATA_STREAM_PREFIX_PATTERN = /^([0-9a-z]):(.*)$/s;

function dataStreamProtocolResult(state: AiSdkConnectorState, data: string): ConnectorResult | null {
  const match = DATA_STREAM_PREFIX_PATTERN.exec(data);
  if (!match) return null;
  const [, prefix, rest] = match;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rest);
  } catch {
    return null;
  }

  switch (prefix) {
    case '0':
      return typeof parsed === 'string' && parsed ? { text: parsed } : null;
    case 'g':
      return typeof parsed === 'string' && parsed ? { reasoning: parsed } : null;
    case '3': {
      const message = typeof parsed === 'string' && parsed ? parsed : 'AI SDK stream reported an error';
      return { error: message, errorPayload: parsed };
    }
    case '9': {
      if (!parsed || typeof parsed !== 'object') return null;
      const record = parsed as Record<string, unknown>;
      const hasArgs = hasOwn(record, 'args') || hasOwn(record, 'input');
      const args = record.args ?? record.input;
      const toolDelta = toolDeltaFromToolCall(state, '9:', record.toolCallId, record.toolName, args, hasArgs);
      return toolDelta ? { toolDelta } : null;
    }
    case 'b': {
      if (!parsed || typeof parsed !== 'object') return null;
      const record = parsed as Record<string, unknown>;
      const toolDelta = toolDeltaFromToolCall(state, 'b:', record.toolCallId, record.toolName, undefined, false);
      return toolDelta ? { toolDelta } : null;
    }
    case 'c': {
      if (!parsed || typeof parsed !== 'object') return null;
      const record = parsed as Record<string, unknown>;
      const fragment = record.argsTextDelta ?? record.inputTextDelta;
      if (typeof fragment !== 'string' || fragment === '') return null;
      const toolDelta = toolDeltaFromToolCall(state, 'c:', record.toolCallId, undefined, fragment, true);
      return toolDelta ? { toolDelta } : null;
    }
    case 'a': {
      if (!parsed || typeof parsed !== 'object') return null;
      const record = parsed as Record<string, unknown>;
      const output = record.result ?? record.output;
      const toolDelta = toolDeltaFromToolResult(state, 'a:', record.toolCallId, output);
      return toolDelta ? { toolDelta } : null;
    }
    case 'd':
    case 'e':
      resetAiSdkState(state);
      return { done: true };
    // Ignored: 1 (data), 2 (data array), 7/8 (annotations), f (start-step),
    // h (reasoning signature), i (redacted reasoning), j (source).
    default:
      return null;
  }
}

/**
 * Vercel AI SDK streaming connector.
 *
 * Reads frames from both Vercel AI SDK protocols:
 *
 * - **UI message stream** (`toUIMessageStreamResponse`, v5+): SSE `data:` lines
 *   carrying JSON like `{"type":"text-delta","delta":"hi"}` or
 *   `{"type":"tool-input-available","toolCallId":"...","input":{...}}`.
 * - **Data stream protocol** (`toDataStreamResponse`, v4): one prefix-coded
 *   frame per line like `0:"hi"` or `9:{"toolCallId":"...","toolName":"..."}`.
 *   The pipeline expects each frame to arrive as the value of an SSE `data:`
 *   field, so a server route that emits raw data-stream lines must wrap each
 *   one as `data: <line>\n\n` (see README's Vercel AI SDK recipe for a one-line
 *   adapter).
 *
 * The connector returns text/reasoning/tool deltas, signals done on `finish` /
 * `finish-message` / `d:` / `e:` frames, and surfaces in-band errors (`type: 'error'`
 * or `3:"..."`) with the original payload as `errorPayload`. Unknown or
 * lifecycle-only frames (`start`, `start-step`, `text-start`, `text-end`, etc.)
 * are silently ignored so the user never sees protocol text. Empty-string
 * argument deltas (`{type:'tool-input-delta', inputTextDelta:''}` and `c:`
 * frames with an empty `argsTextDelta`) are dropped the same way empty
 * `text-delta` / `reasoning-delta` frames are, so an empty fragment never
 * resets accumulated tool input.
 *
 * **`toolCallId` is required** on every tool frame (`tool-input-start` /
 * `tool-call-streaming-start`, `tool-input-delta` / `tool-call-delta`,
 * `tool-input-available` / `tool-call`, `tool-output-available` / `tool-result`,
 * and the data-stream `9:` / `b:` / `c:` / `a:` frames). When a recognized tool
 * frame arrives without a `toolCallId`, the connector intentionally drops the
 * fragment (there is no tool message to merge it into) and emits a dev-only
 * `console.warn` naming the frame type and the missing field. The warning
 * fires at most once per (frame-type, missing-field) combination; production
 * builds stay silent.
 *
 * Usage example:
 *   const { send } = useChorusStream(transport, { connector: 'ai-sdk' });
 */
export const aiSdkConnector: Connector<AiSdkConnectorState> = {
  name: 'ai-sdk',
  createState: createAiSdkConnectorState,
  extract(data: string, state = createAiSdkConnectorState()): ConnectorResult | null {
    if (data === '[DONE]') {
      resetAiSdkState(state);
      return { done: true };
    }

    try {
      const obj = JSON.parse(data);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const result = uiMessageStreamResult(state, obj as Record<string, unknown>, obj);
        if (result) return result;
        const error = extractErrorMessage(obj);
        if (error) return { error, errorPayload: obj };
      }
    } catch {
      const result = dataStreamProtocolResult(state, data);
      if (result) return result;
    }

    return null;
  },
};
