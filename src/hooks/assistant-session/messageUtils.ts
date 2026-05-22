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
  } else if (delta.provider === 'ai-sdk') {
    // The AI SDK connector cannot know the underlying provider family, so it
    // tags deltas with a neutral `provider: 'ai-sdk'`. Persist the captured
    // tool-call id under a provider-neutral `metadata.aiSdk.toolCallId` slot so
    // `autoContinueTools` can re-attach it when replaying the tool result.
    const aiSdk = isRecord(metadata.aiSdk) ? { ...metadata.aiSdk } : {};
    aiSdk.toolCallId = delta.providerId;
    metadata.aiSdk = aiSdk;
  }

  return Object.keys(metadata).length ? metadata as TMeta : existing;
}

export function metadataWithToolError<TMeta>(existing: TMeta | undefined): TMeta {
  const metadata: Record<string, unknown> = isRecord(existing) ? { ...existing } : {};
  metadata.isError = true;
  const anthropic = isRecord(metadata.anthropic) ? { ...metadata.anthropic } : {};
  anthropic.isError = true;
  metadata.anthropic = anthropic;
  return metadata as TMeta;
}

export function hasToolOutput<TMeta>(message: Message<TMeta>) {
  return message.role === 'tool' && Object.prototype.hasOwnProperty.call(message.toolCall, 'output');
}

export function cloneMessageForRetry<TMeta>(message: Message<TMeta>): Message<TMeta> {
  if (message.role === 'user' || message.role === 'assistant') {
    return {
      ...message,
      sources: message.sources?.map(source => ({ ...source, metadata: source.metadata ? { ...source.metadata } : undefined })),
      attachments: message.attachments?.map(attachment => ({ ...attachment })),
    };
  }

  return {
    ...message,
    sources: message.sources?.map(source => ({ ...source, metadata: source.metadata ? { ...source.metadata } : undefined })),
  };
}

export function cloneHistoryForRetry<TMeta>(history: Message<TMeta>[]): Message<TMeta>[] {
  return history.map(message => cloneMessageForRetry(message));
}

export function findLastUserMessage<TMeta>(history: Message<TMeta>[]) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message && message.role === 'user') return message;
  }
  return null;
}

export function normalizeReturnedMessage<TMeta>(message: Partial<Message<TMeta>>): Message<TMeta> {
  const id = message.id || createMessageId();
  const text = message.text ?? '';

  if (message.role === 'tool') {
    const toolCall = message.toolCall ?? { name: 'tool' };
    return {
      id,
      role: 'tool',
      text,
      metadata: message.metadata,
      reasoning: message.reasoning,
      sources: message.sources,
      // Guarantee a stable tool-call id so downstream identity (createToolCallContext,
      // provider-id metadata, delta mapping) can address each tool message uniquely.
      toolCall: toolCall.id ? toolCall : { ...toolCall, id: createMessageId() },
    };
  }

  if (message.role === 'user') {
    return {
      id,
      role: 'user',
      text,
      metadata: message.metadata,
      reasoning: message.reasoning,
      sources: message.sources,
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
      sources: message.sources,
    };
  }

  return {
    id,
    role: 'assistant',
    text,
    metadata: message.metadata,
    reasoning: message.reasoning,
    sources: message.sources,
    attachments: message.attachments,
  };
}
