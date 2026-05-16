import { extractErrorMessage } from './error';
import type { Connector, ConnectorResult, ConnectorToolDelta } from './types';

export interface AnthropicConnectorState {
  toolIdsByBlockIndex: Map<string, string>;
  providerToolIdsByBlockIndex: Map<string, string>;
}

export function createAnthropicConnectorState(): AnthropicConnectorState {
  return { toolIdsByBlockIndex: new Map<string, string>(), providerToolIdsByBlockIndex: new Map<string, string>() };
}

function resetAnthropicState(state: AnthropicConnectorState) {
  state.toolIdsByBlockIndex.clear();
  state.providerToolIdsByBlockIndex.clear();
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
export const anthropicConnector: Connector<AnthropicConnectorState> = {
  name: 'anthropic',
  createState: createAnthropicConnectorState,
  extract(data: string, state = createAnthropicConnectorState()): ConnectorResult | null {
    try {
      const obj = JSON.parse(data);
      const error = extractErrorMessage(obj);
      if (error) return { error, errorPayload: obj };
      if (!obj || typeof obj.type !== 'string') return null;

      if (obj.type === 'message_stop') {
        resetAnthropicState(state);
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
          const explicitId = typeof block.id === 'string' && block.id ? block.id : undefined;
          const id = explicitId ?? fallbackToolId(obj.index);
          const key = blockIndexKey(obj.index);
          state.toolIdsByBlockIndex.set(key, id);
          if (explicitId) state.providerToolIdsByBlockIndex.set(key, explicitId);
          const toolDelta: ConnectorToolDelta = { id, provider: 'anthropic' };
          if (explicitId) toolDelta.providerId = explicitId;
          else toolDelta.generated = true;
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
          const id = state.toolIdsByBlockIndex.get(key) ?? fallbackToolId(obj.index);
          const providerId = state.providerToolIdsByBlockIndex.get(key);
          return { toolDelta: {
            id,
            input: obj.delta.partial_json,
            provider: 'anthropic',
            ...(providerId ? { providerId } : { generated: true }),
          } };
        }
      }

      return null;
    } catch {
      return null;
    }
  }
};
