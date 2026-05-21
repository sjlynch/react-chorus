import { extractErrorMessage } from './error';
import { hasOwn } from './objectUtils';
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
 * and input_json_delta events, the extended-thinking signature from
 * signature_delta events (as `metadata.thinkingSignature`), and signals done
 * on message_stop.
 *
 * Usage example:
 *   const { send } = useChorusStream(transport, { connector: 'anthropic' });
 *
 * @internal Not part of the public API. Obtain it via `getConnector('anthropic')`.
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

      if (obj.type === 'message_delta') {
        const delta = obj.delta && typeof obj.delta === 'object' ? obj.delta as Record<string, unknown> : null;
        const stopReason = typeof delta?.stop_reason === 'string' ? delta.stop_reason : null;
        if (!stopReason) return null;

        const stopSequence = typeof delta?.stop_sequence === 'string' ? delta.stop_sequence : null;
        const metadata: Record<string, unknown> = { stopReason };
        if (stopSequence) metadata.stopSequence = stopSequence;

        if (stopReason === 'refusal') {
          return {
            error: 'Anthropic model refused to respond',
            errorPayload: obj,
            metadata,
          };
        }

        if (stopReason === 'max_tokens') {
          return {
            metadata,
            warning: {
              code: 'truncated',
              message: 'Anthropic response truncated by max_tokens',
              payload: obj,
            },
          };
        }

        // end_turn, stop_sequence, tool_use are all normal terminations; surface stop_reason as
        // metadata so consumers can persist or display it without treating it as a problem.
        return { metadata };
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

        // The signature_delta event closes a thinking block with the cryptographic
        // signature the Anthropic Messages API requires when that thinking block is
        // replayed (e.g. during an autoContinueTools round trip). Surface it as
        // metadata so the provider-request mapper can re-attach it; without this the
        // signature is lost and the replayed request 400s.
        if (
          obj.delta?.type === 'signature_delta' &&
          typeof obj.delta.signature === 'string' &&
          obj.delta.signature
        ) {
          return { metadata: { thinkingSignature: obj.delta.signature } };
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
