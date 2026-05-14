import { extractErrorMessage } from './error';

export interface ConnectorToolDelta { id: string; name?: string; input?: unknown; output?: unknown }
export interface ConnectorResult { text?: string; reasoning?: string; toolDelta?: ConnectorToolDelta; done?: boolean; error?: string }
export interface Connector { name: string; extract: (data: string) => ConnectorResult | null }

const DEFAULT_CHOICE_INDEX = 0;
const THINK_START = '<think>';
const THINK_END = '</think>';

const chatToolCallIds = new Map<string, string>();
const responseToolCallIds = new Map<string, string>();
const thinkState = { inThink: false, buffer: '' };

function resetOpenAIState() {
  chatToolCallIds.clear();
  responseToolCallIds.clear();
  thinkState.inThink = false;
  thinkState.buffer = '';
}

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function appendField(target: ConnectorResult, key: 'text' | 'reasoning', value: string) {
  if (!value) return;
  target[key] = `${target[key] ?? ''}${value}`;
}

function trailingPartialTagLength(value: string, tag: string) {
  const max = Math.min(tag.length - 1, value.length);
  for (let len = max; len > 0; len -= 1) {
    if (tag.startsWith(value.slice(-len))) return len;
  }
  return 0;
}

function splitThinkTaggedContent(chunk: string) {
  let source = thinkState.buffer + chunk;
  thinkState.buffer = '';
  const result: Pick<ConnectorResult, 'text' | 'reasoning'> = {};

  while (source) {
    if (thinkState.inThink) {
      const end = source.indexOf(THINK_END);
      if (end === -1) {
        const keep = trailingPartialTagLength(source, THINK_END);
        const emit = keep > 0 ? source.slice(0, -keep) : source;
        appendField(result, 'reasoning', emit);
        thinkState.buffer = keep > 0 ? source.slice(-keep) : '';
        source = '';
      } else {
        appendField(result, 'reasoning', source.slice(0, end));
        source = source.slice(end + THINK_END.length);
        thinkState.inThink = false;
      }
    } else {
      const start = source.indexOf(THINK_START);
      if (start === -1) {
        const keep = trailingPartialTagLength(source, THINK_START);
        const emit = keep > 0 ? source.slice(0, -keep) : source;
        appendField(result, 'text', emit);
        thinkState.buffer = keep > 0 ? source.slice(-keep) : '';
        source = '';
      } else {
        appendField(result, 'text', source.slice(0, start));
        source = source.slice(start + THINK_START.length);
        thinkState.inThink = true;
      }
    }
  }

  return result;
}

function flushThinkBuffer() {
  const result: Pick<ConnectorResult, 'text' | 'reasoning'> = {};
  if (thinkState.buffer) {
    appendField(result, thinkState.inThink ? 'reasoning' : 'text', thinkState.buffer);
  }
  thinkState.inThink = false;
  thinkState.buffer = '';
  return result;
}

function mergeResult(target: ConnectorResult, source: ConnectorResult | null | undefined) {
  if (!source) return;
  if (source.text) appendField(target, 'text', source.text);
  if (source.reasoning) appendField(target, 'reasoning', source.reasoning);
  if (!target.toolDelta && source.toolDelta) target.toolDelta = source.toolDelta;
  if (source.error) target.error = source.error;
  if (source.done) target.done = true;
}

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

function stringFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return '';
}

function collectTextFragments(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        return stringFromUnknown(obj.text) || stringFromUnknown(obj.summary) || stringFromUnknown(obj.content);
      }
      return '';
    }).join('');
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return stringFromUnknown(obj.text) || stringFromUnknown(obj.summary) || stringFromUnknown(obj.content);
  }
  return '';
}

function extractReasoningFromDelta(delta: Record<string, unknown>) {
  return [
    delta.reasoning,
    delta.reasoning_content,
    delta.reasoning_summary,
    delta.reasoning_summary_text,
  ].map(collectTextFragments).join('');
}

function extractChatToolDelta(choiceKey: string, rawToolCall: unknown): ConnectorToolDelta | null {
  if (!rawToolCall || typeof rawToolCall !== 'object') return null;
  const toolCall = rawToolCall as Record<string, unknown>;
  const rawIndex = typeof toolCall.index === 'number' || typeof toolCall.index === 'string' ? String(toolCall.index) : '0';
  const key = `${choiceKey}:${rawIndex}`;
  const explicitId = typeof toolCall.id === 'string' && toolCall.id ? toolCall.id : undefined;
  if (explicitId) chatToolCallIds.set(key, explicitId);
  const id = explicitId ?? chatToolCallIds.get(key) ?? `openai-${choiceKey}-tool-${rawIndex}`;

  const fn = toolCall.function && typeof toolCall.function === 'object'
    ? toolCall.function as Record<string, unknown>
    : undefined;
  const result: ConnectorToolDelta = { id };
  const name = typeof fn?.name === 'string' && fn.name ? fn.name : undefined;
  if (name) result.name = name;
  if (fn && hasOwn(fn, 'arguments')) result.input = fn.arguments;
  if (hasOwn(toolCall, 'output')) result.output = toolCall.output;
  return result.name || hasOwn(result, 'input') || hasOwn(result, 'output') ? result : null;
}

function extractChatCompletionEvent(obj: Record<string, unknown>): ConnectorResult | null {
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
  if (content) mergeResult(result, splitThinkTaggedContent(content));

  const toolCalls = delta.tool_calls;
  if (Array.isArray(toolCalls)) {
    const choiceKey = getChoiceKey(choice, arrayIndex);
    for (const toolCall of toolCalls) {
      const toolDelta = extractChatToolDelta(choiceKey, toolCall);
      if (toolDelta) {
        result.toolDelta = toolDelta;
        break;
      }
    }
  }

  return result.text || result.reasoning || result.toolDelta ? result : null;
}

function extractResponseToolId(obj: Record<string, unknown>) {
  const itemId = stringFromUnknown(obj.item_id);
  if (itemId) return itemId;
  const outputIndex = typeof obj.output_index === 'number' || typeof obj.output_index === 'string' ? String(obj.output_index) : '';
  return outputIndex ? `openai-response-output-${outputIndex}` : '';
}

function extractOpenAIResponseEvent(obj: Record<string, unknown>): ConnectorResult | null {
  const type = typeof obj.type === 'string' ? obj.type : '';
  const result: ConnectorResult = {};

  if (type === 'response.completed') {
    mergeResult(result, flushThinkBuffer());
    resetOpenAIState();
    result.done = true;
    return result;
  }

  if (type === 'response.failed') {
    const error = extractErrorMessage(obj) || collectTextFragments(obj.response) || 'OpenAI response failed';
    return { error };
  }

  if (type === 'response.output_text.delta') {
    const text = stringFromUnknown(obj.delta);
    if (text) mergeResult(result, splitThinkTaggedContent(text));
  }

  if (
    type === 'response.reasoning_summary_text.delta' ||
    type === 'response.reasoning_text.delta' ||
    type === 'response.reasoning_summary.delta'
  ) {
    const reasoning = collectTextFragments(obj.delta) || collectTextFragments(obj.text);
    if (reasoning) appendField(result, 'reasoning', reasoning);
  }

  if (type === 'response.output_item.added' || type === 'response.output_item.done') {
    const item = obj.item && typeof obj.item === 'object' ? obj.item as Record<string, unknown> : undefined;
    if (item?.type === 'function_call') {
      const id = stringFromUnknown(item.call_id) || stringFromUnknown(item.id) || `openai-response-output-${stringFromUnknown(obj.output_index) || '0'}`;
      const name = stringFromUnknown(item.name);
      if (stringFromUnknown(item.id)) responseToolCallIds.set(stringFromUnknown(item.id), id);
      const toolDelta: ConnectorToolDelta = { id };
      if (name) toolDelta.name = name;
      if (hasOwn(item, 'arguments')) toolDelta.input = item.arguments;
      result.toolDelta = toolDelta;
    }
  }

  if (type === 'response.function_call_arguments.delta') {
    const rawId = extractResponseToolId(obj);
    const id = responseToolCallIds.get(rawId) ?? rawId;
    if (id) result.toolDelta = { id, input: obj.delta };
  }

  return result.text || result.reasoning || result.toolDelta || result.done || result.error ? result : null;
}

/**
 * OpenAI streaming connector.
 * Expects SSE data lines that are either "[DONE]" or JSON with Chat Completions
 * choices[0].delta content/tool_calls/reasoning fields. It also recognises the
 * common Responses API text, reasoning-summary, and function-call delta events.
 * When multiple alternatives are present, only the selected alternative
 * (choice index 0) is emitted; alternatives are not concatenated.
 */
export const openaiConnector: Connector = {
  name: 'openai',
  extract(data: string): ConnectorResult | null {
    if (data === '[DONE]') {
      const result: ConnectorResult = { ...flushThinkBuffer(), done: true };
      resetOpenAIState();
      return result.text || result.reasoning ? result : { done: true };
    }

    try {
      const obj = JSON.parse(data);
      const error = extractErrorMessage(obj);
      if (error) return { error };
      if (!obj || typeof obj !== 'object') return null;

      const event = obj as Record<string, unknown>;
      if (typeof event.type === 'string' && event.type.startsWith('response.')) {
        return extractOpenAIResponseEvent(event);
      }

      if (Array.isArray(event.choices)) return extractChatCompletionEvent(event);
      return null;
    } catch {
      // If provider sends plain text lines for some reason, treat them as text,
      // while still splitting DeepSeek-style <think>...</think> traces.
      if (!data) return null;
      const result = splitThinkTaggedContent(data);
      return result.text || result.reasoning ? result : null;
    }
  }
};
