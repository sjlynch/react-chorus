import { openaiConnector, type Connector, type ConnectorResult } from './openai';
import { anthropicConnector } from './anthropic';

export type { Connector, ConnectorResult } from './openai';
export { anthropicConnector } from './anthropic';

/**
 * Auto connector:
 * - If data === "[DONE]" => { done: true }
 * - If data parses as JSON and looks like OpenAI Chat => extract delta.content
 * - If data parses as JSON and looks like Anthropic Messages => extract text delta
 * - Else, treat as plain text
 */
export const autoConnector: Connector = {
  name: 'auto',
  extract(data: string) {
    if (data === '[DONE]') return { done: true };
    try {
      const obj = JSON.parse(data);
      if (obj && Array.isArray(obj.choices)) return openaiConnector.extract(data);
      if (obj && typeof obj.type === 'string') return anthropicConnector.extract(data);
    } catch {}
    return data ? { text: data } : null;
  }
};

export function getConnector(connector?: Connector | 'auto' | 'openai' | 'anthropic'): Connector {
  if (!connector) return autoConnector;
  if (typeof connector === 'string') {
    if (connector === 'openai') return openaiConnector;
    if (connector === 'anthropic') return anthropicConnector;
    return autoConnector;
  }
  return connector;
}
