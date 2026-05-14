import { extractErrorMessage } from './error';
import type { Connector, ConnectorResult, ConnectorToolDelta } from './openai';

const toolIdsByBlockIndex = new Map<string, string>();

function resetAnthropicState() {
  toolIdsByBlockIndex.clear();
}

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function blockIndexKey(index: unknown) {
  return typeof index === 'number' || typeof index === 'string' ? String(index) : '0';
}

function fallbackToolId(index: unknown) {
  return `anthropic-tool-${blockIndexKey(index)}`;
}

/**
 * Anthropic Messages API streaming connector.
 * Expects SSE data lines with JSON objects containing a "type" field.
 * Yields text from content_block_delta events (delta.type === 'text_delta'),
 * reasoning from thinking blocks/deltas, tool-use deltas from tool_use blocks
 * and input_json_delta events, and signals done on message_stop.
 *
 * Usage example:
 *   const { send } = useChorusStream(transport, { connector: 'anthropic' });
 */
export const anthropicConnector: Connector = {
  name: 'anthropic',
  extract(data: string): ConnectorResult | null {
    try {
      const obj = JSON.parse(data);
      const error = extractErrorMessage(obj);
      if (error) return { error };
      if (!obj || typeof obj.type !== 'string') return null;

      if (obj.type === 'message_stop') {
        resetAnthropicState();
        return { done: true };
      }

      if (obj.type === 'content_block_start') {
        const block = obj.content_block;
        if (!block || typeof block !== 'object') return null;

        if (block.type === 'thinking') {
          const reasoning = typeof block.thinking === 'string' ? block.thinking : '';
          return reasoning ? { reasoning } : null;
        }

        if (block.type === 'tool_use') {
          const id = typeof block.id === 'string' && block.id ? block.id : fallbackToolId(obj.index);
          toolIdsByBlockIndex.set(blockIndexKey(obj.index), id);
          const toolDelta: ConnectorToolDelta = { id };
          if (typeof block.name === 'string' && block.name) toolDelta.name = block.name;
          if (hasOwn(block, 'input')) toolDelta.input = block.input;
          return toolDelta.name || hasOwn(toolDelta, 'input') ? { toolDelta } : null;
        }

        return null;
      }

      if (obj.type === 'content_block_delta') {
        if (
          obj.delta?.type === 'text_delta' &&
          typeof obj.delta.text === 'string' &&
          obj.delta.text
        ) {
          return { text: obj.delta.text };
        }

        if (
          obj.delta?.type === 'thinking_delta' &&
          typeof obj.delta.thinking === 'string' &&
          obj.delta.thinking
        ) {
          return { reasoning: obj.delta.thinking };
        }

        if (obj.delta?.type === 'input_json_delta' && typeof obj.delta.partial_json === 'string') {
          const key = blockIndexKey(obj.index);
          const id = toolIdsByBlockIndex.get(key) ?? fallbackToolId(obj.index);
          return { toolDelta: { id, input: obj.delta.partial_json } };
        }
      }

      return null;
    } catch {
      return null;
    }
  }
};
