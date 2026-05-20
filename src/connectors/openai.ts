import { extractErrorMessage } from './error';
import type { Connector, ConnectorResult } from './types';
import { extractChatCompletionEvent } from './openai/chatCompletions';
import { drainResponseToolBuffer, extractOpenAIResponseEvent } from './openai/responses';
import { appendToolDelta, hasToolDelta, type ResponseToolRef } from './openai/shared';
import {
  compileThinkTags,
  createThinkTagSplitter,
  createThinkTagSplitterState,
  type CompiledThinkTags,
  type ThinkTagSplitterOptions,
  type ThinkTagSplitterState,
} from './openai/thinkTagSplitter';

export type { Connector, ConnectorResult, ConnectorToolDelta, ConnectorWarning } from './types';
export type { ThinkTagSplitterOptions } from './openai/thinkTagSplitter';

export interface OpenAIConnectorOptions {
  /**
   * Override the reasoning tag pair the connector splits out of assistant
   * text. Defaults to `<think>...</think>` matched case-insensitively. Use
   * this to support proxies that emit alternate cases (`<Think>`, `<THINK>`)
   * or custom delimiters (`<reasoning>...</reasoning>`).
   */
  thinkTag?: ThinkTagSplitterOptions;
}

export interface OpenAIConnectorState {
  chatToolCallIds: Map<string, string>;
  /** Resolved Responses function-call identity, keyed by item_id and the output-index fallback. */
  responseToolAliases: Map<string, ResponseToolRef>;
  /** `function_call_arguments.delta` payloads buffered before `output_item.added` resolves the call id. */
  responseToolArgBuffer: Map<string, unknown[]>;
  /** Accumulated refusal text across `response.refusal.delta` events, keyed by item_id or output_index. */
  responseRefusalText: Map<string, string>;
  thinkState: ThinkTagSplitterState;
  /** Think-tag RegExps compiled once when state is created and reused across every chunk. */
  thinkTags: CompiledThinkTags;
}

export function createOpenAIConnectorState(options: OpenAIConnectorOptions = {}): OpenAIConnectorState {
  return {
    chatToolCallIds: new Map<string, string>(),
    responseToolAliases: new Map<string, ResponseToolRef>(),
    responseToolArgBuffer: new Map<string, unknown[]>(),
    responseRefusalText: new Map<string, string>(),
    thinkState: createThinkTagSplitterState(),
    thinkTags: compileThinkTags(options.thinkTag ?? {}),
  };
}

function resetOpenAIState(state: OpenAIConnectorState) {
  state.chatToolCallIds.clear();
  state.responseToolAliases.clear();
  state.responseToolArgBuffer.clear();
  state.responseRefusalText.clear();
  createThinkTagSplitter(state.thinkState, state.thinkTags).reset();
}

function flushOpenAIState(state: OpenAIConnectorState): ConnectorResult | null {
  const result: ConnectorResult = createThinkTagSplitter(state.thinkState, state.thinkTags).flush();
  // Replay any tool-call argument deltas still buffered because their
  // `output_item.added` never arrived, so the call surfaces instead of vanishing.
  const orphanToolDeltas = drainResponseToolBuffer(state);
  resetOpenAIState(state);
  for (const toolDelta of orphanToolDeltas) appendToolDelta(result, toolDelta);
  return result.text || result.reasoning || hasToolDelta(result) ? result : null;
}

function finishResult(result: ConnectorResult | null, state: OpenAIConnectorState) {
  if (result?.done) resetOpenAIState(state);
  return result;
}

/**
 * Build an OpenAI streaming connector with custom options. The returned
 * connector behaves identically to `openaiConnector` except for the supplied
 * overrides (e.g. a custom reasoning tag pair).
 */
export function createOpenAIConnector(options: OpenAIConnectorOptions = {}): Connector<OpenAIConnectorState> {
  const createState = () => createOpenAIConnectorState(options);
  return {
    name: 'openai',
    createState,
    extract(data: string, state = createState()): ConnectorResult | null {
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
        const result = createThinkTagSplitter(state.thinkState, state.thinkTags).feed(data);
        return result.text || result.reasoning ? result : null;
      }
    },
    flush(state = createState()): ConnectorResult | null {
      return flushOpenAIState(state);
    },
  };
}

/**
 * Default OpenAI streaming connector.
 * Expects SSE data lines that are either "[DONE]" or JSON with Chat Completions
 * choices[0].delta content/tool_calls/reasoning fields. It also recognises the
 * common Responses API text, reasoning-summary, and function-call delta events.
 * When multiple alternatives are present, only the selected alternative
 * (choice index 0) is emitted; alternatives are not concatenated.
 *
 * @internal Not part of the public API. Obtain it via `getConnector('openai')`,
 * or call `createOpenAIConnector(options)` for a customized OpenAI connector.
 */
export const openaiConnector: Connector<OpenAIConnectorState> = createOpenAIConnector();
