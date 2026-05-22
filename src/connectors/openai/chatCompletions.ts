import type { ConnectorResult, ConnectorToolDelta } from '../types';
import type { OpenAIConnectorState } from '../openai';
import { warnOnceInDev } from '../../utils/warnings';
import { extractUsage } from '../usage';
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

// Chat Completions `finish_reason` values that signal the response was cut
// short. Mirrors the non-fatal `warning` Gemini/Anthropic already emit so a
// truncated answer is not rendered as if it were complete.
const FINISH_REASON_WARNINGS: Record<string, { code: string; message: string }> = {
  length: { code: 'truncated', message: 'OpenAI response truncated by max_tokens' },
  content_filter: { code: 'content_filter', message: 'OpenAI response stopped by the content filter' },
};

/**
 * Surface token usage at most once per Chat Completions stream. Prefers the
 * usage on the current (terminating) chunk, falling back to whatever was
 * buffered from earlier chunks. Returns `undefined` once usage has already
 * been emitted, so a stream with both a `finish_reason` chunk and a trailing
 * `choices: []` chunk cannot fire `onMetadata` twice.
 */
function takeChatUsage(
  state: OpenAIConnectorState,
  chunkUsage: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (state.chatUsageEmitted) return undefined;
  const usage = chunkUsage ?? state.chatPendingUsage;
  if (!usage) return undefined;
  state.chatUsageEmitted = true;
  return usage;
}

export function extractChatCompletionEvent(obj: Record<string, unknown>, state: OpenAIConnectorState): ConnectorResult | null {
  const choices = obj.choices;
  if (!Array.isArray(choices)) return null;
  if (choices.length === 0) {
    // OpenAI Chat Completions with `stream_options: { include_usage: true }`
    // emits a final `{ choices: [], usage: {...} }` chunk that carries no
    // delta or finish_reason. This is a terminating chunk, so surface its
    // token usage as metadata — without this, a cost-telemetry consumer sees
    // usage on the Responses path but silently nothing here.
    const usage = takeChatUsage(state, extractUsage(obj.usage));
    return usage ? { metadata: { usage } } : null;
  }

  const { choice, arrayIndex } = selectedChoice(choices);
  if (!choice || typeof choice !== 'object') return null;
  const choiceObj = choice as Record<string, unknown>;
  const delta = choiceObj.delta && typeof choiceObj.delta === 'object'
    ? choiceObj.delta as Record<string, unknown>
    : undefined;

  const result: ConnectorResult = {};

  if (delta) {
    const reasoning = extractReasoningFromDelta(delta);
    if (reasoning) appendField(result, 'reasoning', reasoning);

    const content = typeof delta.content === 'string' ? delta.content : '';
    if (content) mergeResult(result, createThinkTagSplitter(state.thinkState, state.thinkTags).feed(content));

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
  }

  // Buffer the latest `usage`. Some OpenAI-compatible proxies (Azure OpenAI,
  // OpenRouter) attach a cumulative `usage` object to every content chunk;
  // emitting `metadata.usage` per chunk would make a non-idempotent
  // `onMetadata` consumer (a running cost counter) over-count. Buffer it and
  // surface it once, on the terminating chunk — matching the Gemini/Responses
  // connectors and the trailing `choices: []` frame handled above.
  const chunkUsage = extractUsage(obj.usage);
  if (chunkUsage) state.chatPendingUsage = chunkUsage;

  // A non-null `finish_reason` terminates the stream. Many proxies (Azure
  // OpenAI, OpenRouter) omit the trailing `data: [DONE]`, so without this the
  // chat-completions branch never emits `done` and the reader hangs.
  const finishReason = choiceObj.finish_reason;
  if (typeof finishReason === 'string' && finishReason) {
    mergeResult(result, createThinkTagSplitter(state.thinkState, state.thinkTags).flush());
    result.done = true;
    result.metadata = { ...(result.metadata ?? {}), finishReason };
    // This is the terminating chunk — surface the buffered usage (or this
    // chunk's own usage) exactly once.
    const usage = takeChatUsage(state, chunkUsage);
    if (usage) result.metadata.usage = usage;
    const warning = FINISH_REASON_WARNINGS[finishReason];
    if (warning) result.warning = { code: warning.code, message: warning.message, payload: obj };
  }

  return result.text || result.reasoning || hasToolDelta(result) || result.done || result.metadata ? result : null;
}
