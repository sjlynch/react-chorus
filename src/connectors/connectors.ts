import { openaiConnector, type Connector, type ConnectorResult } from './openai';

export type { Connector, ConnectorResult } from './openai';

/**
 * Auto connector:
 * - If data === "[DONE]" => { done: true }
 * - If data parses as JSON and looks like OpenAI Chat => extract delta.content
 * - Else, treat as plain text
 */
export const autoConnector: Connector = {
  name: 'auto',
  extract(data: string) {
    if (data === '[DONE]') return { done: true };
    try {
      const obj = JSON.parse(data);
      if (obj && Array.isArray(obj.choices)) return openaiConnector.extract(data);
    } catch {}
    return data ? { text: data } : null;
  }
};

export function getConnector(connector?: Connector | 'auto' | 'openai'): Connector {
  if (!connector) return autoConnector;
  if (typeof connector === 'string') {
    if (connector === 'openai') return openaiConnector;
    return autoConnector;
  }
  return connector;
}
