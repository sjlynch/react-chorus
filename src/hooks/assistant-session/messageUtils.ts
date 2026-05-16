import type { Message } from '../../types';
import type { ConnectorToolDelta } from '../../connectors/connectors';
import { createRandomId } from '../../utils/ids';

export function createMessageId() {
  return createRandomId('chorus');
}

export function dropTrailingAssistant<TMeta>(history: Message<TMeta>[]) {
  const last = history[history.length - 1];
  return last?.role === 'assistant' ? history.slice(0, -1) : history;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function metadataWithToolProvider<TMeta>(existing: TMeta | undefined, delta: ConnectorToolDelta): TMeta | undefined {
  if (!delta.providerId) return existing;

  const metadata: Record<string, unknown> = isRecord(existing) ? { ...existing } : {};
  if (delta.provider === 'openai') {
    const openai = isRecord(metadata.openai) ? { ...metadata.openai } : {};
    openai.toolCallId = delta.providerId;
    openai.callId = delta.providerId;
    metadata.openai = openai;
  } else if (delta.provider === 'anthropic') {
    const anthropic = isRecord(metadata.anthropic) ? { ...metadata.anthropic } : {};
    anthropic.toolUseId = delta.providerId;
    metadata.anthropic = anthropic;
  }

  return Object.keys(metadata).length ? metadata as TMeta : existing;
}

export function hasToolOutput<TMeta>(message: Message<TMeta>) {
  return message.role === 'tool' && Object.prototype.hasOwnProperty.call(message.toolCall, 'output');
}

export function cloneMessageForRetry<TMeta>(message: Message<TMeta>): Message<TMeta> {
  if (message.role === 'user' || message.role === 'assistant') {
    return {
      ...message,
      attachments: message.attachments?.map(attachment => ({ ...attachment })),
    };
  }

  return { ...message };
}

export function cloneHistoryForRetry<TMeta>(history: Message<TMeta>[]): Message<TMeta>[] {
  return history.map(message => cloneMessageForRetry(message));
}

export function findLastUserMessage<TMeta>(history: Message<TMeta>[]) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === 'user') return history[i];
  }
  return null;
}

export function normalizeReturnedMessage<TMeta>(message: Partial<Message<TMeta>>): Message<TMeta> {
  const id = message.id || createMessageId();
  const text = message.text ?? '';

  if (message.role === 'tool') {
    return {
      id,
      role: 'tool',
      text,
      metadata: message.metadata,
      reasoning: message.reasoning,
      toolCall: message.toolCall ?? { name: 'tool' },
    };
  }

  if (message.role === 'user') {
    return {
      id,
      role: 'user',
      text,
      metadata: message.metadata,
      reasoning: message.reasoning,
      attachments: message.attachments,
    };
  }

  if (message.role === 'system') {
    return {
      id,
      role: 'system',
      text,
      metadata: message.metadata,
      reasoning: message.reasoning,
    };
  }

  return {
    id,
    role: 'assistant',
    text,
    metadata: message.metadata,
    reasoning: message.reasoning,
    attachments: message.attachments,
  };
}
