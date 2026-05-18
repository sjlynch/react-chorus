import type { ConnectorResult, ConnectorToolDelta } from '../types';
import type { OpenAIConnectorState } from '../openai';
import { warnOnceInDev } from '../../utils/warnings';
import { appendField, appendToolDelta, collectTextFragments, hasOwn, hasToolDelta, mergeResult } from './shared';
import { createThinkTagSplitter } from './thinkTagSplitter';

const DEFAULT_CHOICE_INDEX = 0;

function selectedChoice(choices: unknown[]) {
  const explicitIndex = choices.findIndex(choice => (choice as { index?: unknown } | null)?.index === DEFAULT_CHOICE_INDEX);
  const index = explicitIndex >= 0 ? explicitIndex : 0;
  return { choice: choices[index], arrayIndex: index };
}

function getChoiceKey(choice: unknown, arrayIndex: number) {
  const providerIndex = (choice as { index?: unknown } | null)?.index;
  return typeof providerIndex === 'number' || typeof providerIndex === 'string'
    ? String(providerIndex)
    : String(arrayIndex);
}

function extractReasoningFromDelta(delta: Record<string, unknown>) {
  // Chat Completions-compatible deltas should prefer reasoning_content. Some
  // proxies populate multiple reasoning fields in one chunk for cross-API
  // compatibility, so choose the first populated source instead of joining
  // unrelated fields together.
  return [
    delta.reasoning_content,
    delta.reasoning_summary_text,
    delta.reasoning,
    delta.reasoning_summary,
  ].map(collectTextFragments).find(Boolean) ?? '';
}

function extractChatToolDelta(
  choiceKey: string,
  rawToolCall: unknown,
  arrayPosition: number,
  providerLabel: string,
  state: OpenAIConnectorState,
): ConnectorToolDelta | null {
  if (!rawToolCall || typeof rawToolCall !== 'object') return null;
  const toolCall = rawToolCall as Record<string, unknown>;
  const hasIndex = typeof toolCall.index === 'number' || typeof toolCall.index === 'string';
  if (!hasIndex) {
    warnOnceInDev(
      `openai-chat-tool-call-missing-index:${providerLabel}`,
      `[react-chorus] OpenAI Chat Completions tool_call delta from "${providerLabel}" is missing required "index" field; falling back to array position. Parallel tool_calls may merge if this provider repeats the omission.`,
    );
  }
  const rawIndex = hasIndex ? String(toolCall.index) : String(arrayPosition);
  const key = `${choiceKey}:${rawIndex}`;
  const explicitId = typeof toolCall.id === 'string' && toolCall.id ? toolCall.id : undefined;
  if (explicitId) state.chatToolCallIds.set(key, explicitId);
  const storedId = state.chatToolCallIds.get(key);
  const generated = !explicitId && !storedId;
  const id = explicitId ?? storedId ?? `openai-${choiceKey}-tool-${rawIndex}`;

  const fn = toolCall.function && typeof toolCall.function === 'object'
    ? toolCall.function as Record<string, unknown>
    : undefined;
  const result: ConnectorToolDelta = { id, provider: 'openai' };
  if (generated) result.generated = true;
  else result.providerId = id;
  const name = typeof fn?.name === 'string' && fn.name ? fn.name : undefined;
  if (name) result.name = name;
  if (fn && hasOwn(fn, 'arguments')) result.input = fn.arguments;
  if (hasOwn(toolCall, 'output')) result.output = toolCall.output;
  return result.name || hasOwn(result, 'input') || hasOwn(result, 'output') ? result : null;
}

export function extractChatCompletionEvent(obj: Record<string, unknown>, state: OpenAIConnectorState): ConnectorResult | null {
  const choices = obj.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const { choice, arrayIndex } = selectedChoice(choices);
  if (!choice || typeof choice !== 'object') return null;
  const choiceObj = choice as Record<string, unknown>;
  const delta = choiceObj.delta && typeof choiceObj.delta === 'object'
    ? choiceObj.delta as Record<string, unknown>
    : undefined;
  if (!delta) return null;

  const result: ConnectorResult = {};
  const reasoning = extractReasoningFromDelta(delta);
  if (reasoning) appendField(result, 'reasoning', reasoning);

  const content = typeof delta.content === 'string' ? delta.content : '';
  if (content) mergeResult(result, createThinkTagSplitter(state.thinkState, state.thinkOptions).feed(content));

  const toolCalls = delta.tool_calls;
  if (Array.isArray(toolCalls)) {
    const choiceKey = getChoiceKey(choice, arrayIndex);
    const providerLabel = typeof obj.model === 'string' && obj.model
      ? obj.model
      : 'unknown OpenAI-compatible provider';
    for (let i = 0; i < toolCalls.length; i++) {
      const toolDelta = extractChatToolDelta(choiceKey, toolCalls[i], i, providerLabel, state);
      if (toolDelta) appendToolDelta(result, toolDelta);
    }
  }

  return result.text || result.reasoning || hasToolDelta(result) ? result : null;
}
