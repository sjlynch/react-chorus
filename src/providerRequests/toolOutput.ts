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

function toolOutputValue<TMeta>(message: Message<TMeta>) {
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
  const rawText = messageText(message);
  const text = rawText.trim();

  if (!message.toolCall) {
    return text ? `Tool result:\n${text}` : null;
  }

  const name = message.toolCall.name || 'tool';
  const input = safeStringify(message.toolCall.input ?? null);
  const output = safeStringify(message.toolCall.output ?? (text ? rawText : null));
  return `Tool call ${name}\nInput:\n${input}\nOutput:\n${output}`;
}

export function objectToolInput(value: unknown) {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {}
    return { input: value };
  }
  if (value === undefined) return {};
  return { input: value };
}
