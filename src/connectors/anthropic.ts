import type { Connector, ConnectorResult } from './openai';

/**
 * Anthropic Messages API streaming connector.
 * Expects SSE data lines with JSON objects containing a "type" field.
 * Yields text from content_block_delta events (delta.type === 'text_delta').
 * Signals done on message_stop.
 *
 * Usage example:
 *   const { send } = useChorusStream(transport, { connector: 'anthropic' });
 */
export const anthropicConnector: Connector = {
  name: 'anthropic',
  extract(data: string): ConnectorResult | null {
    try {
      const obj = JSON.parse(data);
      if (!obj || typeof obj.type !== 'string') return null;

      if (obj.type === 'message_stop') return { done: true };

      if (
        obj.type === 'content_block_delta' &&
        obj.delta?.type === 'text_delta' &&
        typeof obj.delta.text === 'string' &&
        obj.delta.text
      ) {
        return { text: obj.delta.text };
      }

      return null;
    } catch {
      return null;
    }
  }
};
