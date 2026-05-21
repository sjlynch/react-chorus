import type { Message } from '../types';
import { hasOwn, isRecord } from './metadata';

export function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function messageText<TMeta>(message: Message<TMeta>): string {
  return message.text ?? '';
}

export function toolOutputValue<TMeta>(message: Message<TMeta>) {
  const rawText = messageText(message);
  if (message.toolCall && hasOwn(message.toolCall, 'output')) return message.toolCall.output;
  const text = rawText.trim();
  return text ? rawText : undefined;
}

export function toolOutputText<TMeta>(message: Message<TMeta>) {
  const text = messageText(message).trim();
  const rendered = safeStringify(toolOutputValue(message));
  return rendered || text;
}

export function compactJSONString(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {}) ?? '{}';
  } catch {
    return safeStringify(value ?? {});
  }
}

export function toolContextText<TMeta>(message: Message<TMeta>) {
  const text = messageText(message).trim();

  if (!message.toolCall) {
    return text ? `Tool result:\n${text}` : null;
  }

  const name = message.toolCall.name || 'tool';
  const input = safeStringify(message.toolCall.input ?? null);
  // Resolve output via toolOutputValue so an explicit `output: null` is honored
  // (rendered as an empty Output) consistently with the structured provider
  // paths, instead of `??` silently falling through to the streamed text.
  const output = safeStringify(toolOutputValue(message));
  return `Tool call ${name}\nInput:\n${input}\nOutput:\n${output}`;
}

// Normalize a tool-call `input` into the object shape required by
// `tool_use.input` (Anthropic) and `functionCall.args` (Gemini), both typed
// `Record<string, unknown>`. A record (or a string encoding one) is used
// directly; any non-object value — including an array, which is never a valid
// argument object — is wrapped as `{ input: <value> }`. A JSON-array string is
// parsed first so it is treated the same as a bare array. `openAIToolCallArguments`
// mirrors this policy for OpenAI tool-call `arguments`.
export function objectToolInput(value: unknown) {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
      if (Array.isArray(parsed)) return { input: parsed };
    } catch {}
    return { input: value };
  }
  if (value === undefined) return {};
  return { input: value };
}
