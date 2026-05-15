import type { ConnectorName } from '../types';
import { openaiConnector, type Connector } from './openai';
import { anthropicConnector } from './anthropic';
import { geminiConnector } from './gemini';
import { extractErrorMessage } from './error';
import { isChorusDevMode } from '../utils/devMode';

export type { Connector, ConnectorResult, ConnectorToolDelta } from './openai';
export { anthropicConnector } from './anthropic';
export { geminiConnector } from './gemini';

interface AutoConnectorState {
  openai?: ReturnType<NonNullable<typeof openaiConnector.createState>>;
  anthropic?: ReturnType<NonNullable<typeof anthropicConnector.createState>>;
  gemini?: ReturnType<NonNullable<typeof geminiConnector.createState>>;
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
  };
}

/**
 * Auto connector:
 * - If data === "[DONE]" => { done: true }
 * - If data parses as JSON and looks like OpenAI Chat/Responses => extract text/reasoning/tool deltas
 * - If data parses as JSON and looks like Anthropic Messages => extract text/reasoning/tool deltas
 * - If data parses as JSON and looks like Gemini => extract candidates text/reasoning/tool deltas
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
      if (error) return { error };
      if (obj && Array.isArray(obj.choices)) return openaiConnector.extract(data, state.openai);
      if (obj && Array.isArray(obj.candidates)) return geminiConnector.extract(data, state.gemini);
      if (obj && typeof obj.type === 'string' && obj.type.startsWith('response.')) return openaiConnector.extract(data, state.openai);
      if (obj && typeof obj.type === 'string' && KNOWN_ANTHROPIC_EVENT_TYPES.has(obj.type)) return anthropicConnector.extract(data, state.anthropic);
      const genericText = genericJSONText(obj);
      if (genericText) return { text: genericText };
    } catch {}
    return data ? { text: data } : null;
  }
};

const VALID_CONNECTOR_NAMES = ['auto', 'openai', 'anthropic', 'gemini'] as const;
const warnedUnknownConnectorNames = new Set<string>();

export function getConnector(connector?: Connector | ConnectorName): Connector {
  if (!connector) return autoConnector;
  if (typeof connector === 'string') {
    if (connector === 'auto') return autoConnector;
    if (connector === 'openai') return openaiConnector;
    if (connector === 'anthropic') return anthropicConnector;
    if (connector === 'gemini') return geminiConnector;

    if (isChorusDevMode() && !warnedUnknownConnectorNames.has(connector)) {
      warnedUnknownConnectorNames.add(connector);
      console.warn(`[Chorus] Unknown connector \`${connector}\`; falling back to \`auto\`. Valid connector names: ${VALID_CONNECTOR_NAMES.join(', ')}.`);
    }

    return autoConnector;
  }
  return connector;
}
