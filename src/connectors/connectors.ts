import type { ConnectorName } from '../types';
import { openaiConnector, type Connector } from './openai';
import { anthropicConnector } from './anthropic';
import { geminiConnector } from './gemini';
import { extractErrorMessage } from './error';

export type { Connector, ConnectorResult, ConnectorToolDelta } from './openai';
export { anthropicConnector } from './anthropic';
export { geminiConnector } from './gemini';

/**
 * Auto connector:
 * - If data === "[DONE]" => { done: true }
 * - If data parses as JSON and looks like OpenAI Chat/Responses => extract text/reasoning/tool deltas
 * - If data parses as JSON and looks like Anthropic Messages => extract text/reasoning/tool deltas
 * - If data parses as JSON and looks like Gemini => extract candidates text/reasoning/tool deltas
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
      if (obj && typeof obj.type === 'string' && obj.type.startsWith('response.')) return openaiConnector.extract(data);
      if (obj && typeof obj.type === 'string') return anthropicConnector.extract(data);
    } catch {}
    return data ? { text: data } : null;
  }
};

export function getConnector(connector?: Connector | ConnectorName): Connector {
  if (!connector) return autoConnector;
  if (typeof connector === 'string') {
    if (connector === 'openai') return openaiConnector;
    if (connector === 'anthropic') return anthropicConnector;
    if (connector === 'gemini') return geminiConnector;
    return autoConnector;
  }
  return connector;
}
