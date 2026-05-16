import { extractErrorMessage } from './error';
import type { Connector, ConnectorResult } from './types';
import { extractChatCompletionEvent } from './openai/chatCompletions';
import { extractOpenAIResponseEvent } from './openai/responses';
import { createThinkTagSplitter, createThinkTagSplitterState, type ThinkTagSplitterState } from './openai/thinkTagSplitter';

export type { Connector, ConnectorResult, ConnectorToolDelta } from './types';

export interface OpenAIConnectorState {
  chatToolCallIds: Map<string, string>;
  responseToolCallIds: Map<string, string>;
  thinkState: ThinkTagSplitterState;
}

export function createOpenAIConnectorState(): OpenAIConnectorState {
  return {
    chatToolCallIds: new Map<string, string>(),
    responseToolCallIds: new Map<string, string>(),
    thinkState: createThinkTagSplitterState(),
  };
}

function resetOpenAIState(state: OpenAIConnectorState) {
  state.chatToolCallIds.clear();
  state.responseToolCallIds.clear();
  createThinkTagSplitter(state.thinkState).reset();
}

function flushOpenAIState(state: OpenAIConnectorState): ConnectorResult | null {
  const result = createThinkTagSplitter(state.thinkState).flush();
  resetOpenAIState(state);
  return result.text || result.reasoning ? result : null;
}

function finishResult(result: ConnectorResult | null, state: OpenAIConnectorState) {
  if (result?.done) resetOpenAIState(state);
  return result;
}

/**
 * OpenAI streaming connector.
 * Expects SSE data lines that are either "[DONE]" or JSON with Chat Completions
 * choices[0].delta content/tool_calls/reasoning fields. It also recognises the
 * common Responses API text, reasoning-summary, and function-call delta events.
 * When multiple alternatives are present, only the selected alternative
 * (choice index 0) is emitted; alternatives are not concatenated.
 */
export const openaiConnector: Connector<OpenAIConnectorState> = {
  name: 'openai',
  createState: createOpenAIConnectorState,
  extract(data: string, state = createOpenAIConnectorState()): ConnectorResult | null {
    if (data === '[DONE]') {
      const flushed = flushOpenAIState(state);
      return flushed ? { ...flushed, done: true } : { done: true };
    }

    try {
      const obj = JSON.parse(data);
      const error = extractErrorMessage(obj);
      if (error) return { error, errorPayload: obj };
      if (!obj || typeof obj !== 'object') return null;

      const event = obj as Record<string, unknown>;
      if (typeof event.type === 'string' && event.type.startsWith('response.')) {
        return finishResult(extractOpenAIResponseEvent(event, state), state);
      }

      if (Array.isArray(event.choices)) return extractChatCompletionEvent(event, state);
      return null;
    } catch {
      // If provider sends plain text lines for some reason, treat them as text,
      // while still splitting DeepSeek-style <think>...</think> traces.
      if (!data) return null;
      const result = createThinkTagSplitter(state.thinkState).feed(data);
      return result.text || result.reasoning ? result : null;
    }
  },
  flush(state = createOpenAIConnectorState()): ConnectorResult | null {
    return flushOpenAIState(state);
  },
};
