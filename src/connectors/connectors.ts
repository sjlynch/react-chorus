import type { ConnectorName } from '../types';
import { openaiConnector, type Connector } from './openai';
import { anthropicConnector } from './anthropic';
import { geminiConnector } from './gemini';
import { extractErrorMessage } from './error';
import { isChorusDevMode } from '../utils/devMode';

export type { Connector, ConnectorResult } from './openai';
export { anthropicConnector } from './anthropic';
export { geminiConnector } from './gemini';

/**
 * Auto connector:
 * - If data === "[DONE]" => { done: true }
 * - If data parses as JSON and looks like OpenAI Chat => extract delta.content
 * - If data parses as JSON and looks like Anthropic Messages => extract text delta
 * - If data parses as JSON and looks like Gemini => extract candidates text
 * - Else, treat as plain text
 */
export const autoConnector: Connector = {
  name: 'auto',
  extract(data: string) {
    if (data === '[DONE]') return { done: true };
    try {
      const obj = JSON.parse(data);
      const error = extractErrorMessage(obj);
      if (error) return { error };
      if (obj && Array.isArray(obj.choices)) return openaiConnector.extract(data);
      if (obj && Array.isArray(obj.candidates)) return geminiConnector.extract(data);
      if (obj && typeof obj.type === 'string') return anthropicConnector.extract(data);
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
