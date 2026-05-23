import { extractErrorMessage } from '../error';
import type { Connector, ConnectorResult } from '../types';
import { handleContentBlockDelta } from './contentBlockDelta';
import { handleContentBlockStart } from './contentBlockStart';
import { handleMessageDelta } from './messageDelta';
import { handleMessageStart } from './messageStart';
import {
  createAnthropicConnectorState,
  resetAnthropicState,
  type AnthropicConnectorState,
} from './state';

/**
 * Anthropic Messages API streaming connector.
 * Expects SSE data lines with JSON objects containing a "type" field.
 * Yields text from content_block_delta events (delta.type === 'text_delta'),
 * reasoning from thinking blocks/deltas, tool-use deltas from tool_use blocks
 * and input_json_delta events, the extended-thinking signature from
 * signature_delta events (as `metadata.thinkingSignature`), token usage as
 * `metadata.usage` from message_start (input tokens) and message_delta
 * (output tokens), and signals done on message_stop.
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

      const payload = obj as Record<string, unknown>;

      switch (payload.type) {
        case 'message_stop':
          resetAnthropicState(state);
          return { done: true };
        case 'message_start':
          return handleMessageStart(payload);
        case 'message_delta':
          return handleMessageDelta(payload);
        case 'content_block_start':
          return handleContentBlockStart(payload, state);
        case 'content_block_delta':
          return handleContentBlockDelta(payload, state);
        default:
          return null;
      }
    } catch {
      return null;
    }
  },
  flush(state = createAnthropicConnectorState()): ConnectorResult | null {
    // This connector buffers no partial output between chunks — its only
    // per-send memory is the block-index → tool-id maps, normally cleared on
    // `message_stop`. On an abnormal close (body ends without `message_stop`)
    // reset them so a reused state object cannot leak ids into a later send;
    // there is no buffered tail to emit, so the result is always null.
    resetAnthropicState(state);
    return null;
  },
};
