import type { ConnectorName } from '../types';
import type { Connector } from './types';
import { openaiConnector, createOpenAIConnector, type OpenAIConnectorOptions } from './openai';
import { anthropicConnector } from './anthropic';
import { geminiConnector } from './gemini';
import { aiSdkConnector } from './aiSdk';
import { extractErrorMessage } from './error';

export type { Connector, ConnectorResult, ConnectorToolDelta } from './types';
export { anthropicConnector } from './anthropic';
export { geminiConnector } from './gemini';
export { aiSdkConnector } from './aiSdk';
export { createOpenAIConnector, type OpenAIConnectorOptions } from './openai';

interface AutoConnectorState {
  openai?: ReturnType<NonNullable<typeof openaiConnector.createState>>;
  anthropic?: ReturnType<NonNullable<typeof anthropicConnector.createState>>;
  gemini?: ReturnType<NonNullable<typeof geminiConnector.createState>>;
  aiSdk?: ReturnType<NonNullable<typeof aiSdkConnector.createState>>;
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

// Vercel AI SDK UI message stream event types (`toUIMessageStreamResponse`).
// Used by autoConnector to dispatch to aiSdkConnector when JSON payloads carry
// one of these hyphenated type values; the data-stream protocol (`0:"..."`,
// `9:{...}`, etc.) is detected by prefix in the catch path below.
const KNOWN_AI_SDK_EVENT_TYPES = new Set([
  'text-delta',
  'text-start',
  'text-end',
  'reasoning-delta',
  'reasoning-start',
  'reasoning-end',
  'tool-input-start',
  'tool-input-delta',
  'tool-input-available',
  'tool-output-available',
  'tool-call',
  'tool-result',
  'finish',
  'finish-step',
  'finish-message',
  'start',
  'start-step',
  'source-url',
  'source-document',
  'file',
]);

const AI_SDK_DATA_STREAM_PREFIX_PATTERN = /^[0-9a-z]:/;

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

/**
 * Auto connector:
 * - If data === "[DONE]" => { done: true }
 * - If data parses as JSON and looks like OpenAI Chat/Responses => extract text/reasoning/tool deltas
 * - If data parses as JSON and looks like Anthropic Messages => extract text/reasoning/tool deltas
 * - If data parses as JSON and looks like Gemini => extract candidates text/reasoning/tool deltas
 * - If data parses as JSON and looks like a Vercel AI SDK UI message stream event => extract via aiSdkConnector
 * - If data matches the Vercel AI SDK data-stream protocol (`0:"..."`, `9:{...}`) => extract via aiSdkConnector
 * - Else, treat as plain text
 */
export const autoConnector: Connector<AutoConnectorState> = {
  name: 'auto',
  createState: createAutoConnectorState,
  extract(data: string, state = createAutoConnectorState()) {
    if (data === '[DONE]') return openaiConnector.extract(data, state.openai) ?? { done: true };
    try {
      const obj = JSON.parse(data);
      const error = extractErrorMessage(obj);
      if (error) return { error, errorPayload: obj };
      if (obj && Array.isArray(obj.choices)) return openaiConnector.extract(data, state.openai);
      if (obj && Array.isArray(obj.candidates)) return geminiConnector.extract(data, state.gemini);
      if (obj && typeof obj.type === 'string' && obj.type.startsWith('response.')) return openaiConnector.extract(data, state.openai);
      if (obj && typeof obj.type === 'string' && KNOWN_ANTHROPIC_EVENT_TYPES.has(obj.type)) return anthropicConnector.extract(data, state.anthropic);
      if (obj && typeof obj.type === 'string' && KNOWN_AI_SDK_EVENT_TYPES.has(obj.type)) return aiSdkConnector.extract(data, state.aiSdk);
      const genericText = genericJSONText(obj);
      if (genericText) return { text: genericText };
    } catch {
      if (AI_SDK_DATA_STREAM_PREFIX_PATTERN.test(data)) return aiSdkConnector.extract(data, state.aiSdk);
    }
    return data ? { text: data } : null;
  },
  flush(state = createAutoConnectorState()) {
    return openaiConnector.flush?.(state.openai) ?? null;
  }
};

const VALID_CONNECTOR_NAMES = ['auto', 'openai', 'anthropic', 'gemini', 'ai-sdk'] as const;
const warnedUnknownConnectorNames = new Set<string>();

function isConnectorDevMode() {
  // Local to keep connector-only chunks independent from widget dev helpers.
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

export function getConnector(connector?: Connector | ConnectorName, options?: OpenAIConnectorOptions): Connector {
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
