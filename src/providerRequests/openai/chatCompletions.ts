import type { Message } from '../../types';
import { openAIImageUrlFromAttachment, unsupportedAttachmentText } from '../attachments';
import { hasOwn, isRecord, metadataArray, nonEmptyString } from '../metadata';
import { stripOpenAIChatOptions } from '../options';
import { compactJSONString, messageText, toolContextText, toolOutputText } from '../toolOutput';
import type { ProviderMappingOptions } from '../types/common';
import type {
  OpenAIChatCompletionsAssistantMessage,
  OpenAIChatCompletionsBody,
  OpenAIChatCompletionsBodyOptions,
  OpenAIChatCompletionsMessage,
  OpenAIChatCompletionsToolCall,
  OpenAIChatCompletionsUserContentPart,
} from '../types/openaiChat';
import { openAIToolCallId } from './shared';

function openAIAssistantToolCalls(message: Message<unknown>): OpenAIChatCompletionsToolCall[] | null {
  // Tool call shapes come from caller-supplied metadata; we trust the structure here.
  return metadataArray(message, 'openai', ['toolCalls', 'tool_calls'], [
    'openaiToolCalls',
    'openai_tool_calls',
    'toolCalls',
    'tool_calls',
  ]) as OpenAIChatCompletionsToolCall[] | null;
}

function openAIChatToolCallIdFromValue(value: unknown) {
  return isRecord(value) ? nonEmptyString(value.id) : null;
}

function openAIChatToolCall(message: Message<unknown>): OpenAIChatCompletionsToolCall | null {
  const id = openAIToolCallId(message);
  if (!id || !message.toolCall) return null;
  return {
    id,
    type: 'function',
    function: {
      name: message.toolCall.name || 'tool',
      arguments: compactJSONString(message.toolCall.input ?? {}),
    },
  };
}

function appendOpenAIChatToolCalls(target: OpenAIChatCompletionsMessage[], toolCalls: OpenAIChatCompletionsToolCall[]) {
  const last = target[target.length - 1];
  const existing: OpenAIChatCompletionsToolCall[] =
    last?.role === 'assistant' && Array.isArray(last.tool_calls) ? last.tool_calls : [];
  const seenIds = new Set<string>();

  for (const toolCall of existing) {
    const id = openAIChatToolCallIdFromValue(toolCall);
    if (id) seenIds.add(id);
  }

  const dedupedToolCalls: OpenAIChatCompletionsToolCall[] = [];
  for (const toolCall of toolCalls) {
    const id = openAIChatToolCallIdFromValue(toolCall);
    if (id && seenIds.has(id)) continue;
    if (id) seenIds.add(id);
    dedupedToolCalls.push(toolCall);
  }

  if (!dedupedToolCalls.length) return;

  if (last?.role === 'assistant') {
    last.content = hasOwn(last, 'content') ? last.content : null;
    last.tool_calls = existing.concat(dedupedToolCalls);
    return;
  }

  target.push({ role: 'assistant', content: null, tool_calls: dedupedToolCalls });
}

function openAIChatUserContent<TMeta>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
): string | OpenAIChatCompletionsUserContentPart[] | null {
  const parts: OpenAIChatCompletionsUserContentPart[] = [];
  const text = messageText(message);
  if (text.trim()) parts.push({ type: 'text', text });

  for (const attachment of message.attachments ?? []) {
    const imageUrl = attachment.type.startsWith('image/') ? openAIImageUrlFromAttachment(attachment) : null;
    if (imageUrl) {
      parts.push({ type: 'image_url', image_url: { url: imageUrl } });
    } else {
      parts.push({ type: 'text', text: unsupportedAttachmentText(attachment, message, options) });
    }
  }

  if (!parts.length) return null;
  const single = parts[0];
  return parts.length === 1 && single && single.type === 'text' ? single.text : parts;
}

function toOpenAIChatCompletionsMessage<TMeta>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
): OpenAIChatCompletionsMessage | null {
  if (message.role === 'system') {
    return message.text.trim() ? { role: 'system', content: message.text } : null;
  }

  if (message.role === 'assistant') {
    const toolCalls = openAIAssistantToolCalls(message as Message<unknown>);
    const hasText = Boolean(message.text.trim());
    if (!hasText && !toolCalls?.length) return null;
    const assistant: OpenAIChatCompletionsAssistantMessage = toolCalls?.length
      ? { role: 'assistant', content: hasText ? message.text : null, tool_calls: toolCalls }
      : { role: 'assistant', content: message.text };
    return assistant;
  }

  if (message.role === 'user') {
    const content = openAIChatUserContent(message, options);
    return content !== null ? { role: 'user', content } : null;
  }

  if (message.role === 'tool') {
    const toolCallId = openAIToolCallId(message as Message<unknown>);
    if (toolCallId) return { role: 'tool', tool_call_id: toolCallId, content: toolOutputText(message) };

    const content = toolContextText(message);
    return content ? { role: 'system', content } : null;
  }

  return null;
}

/** Convert Chorus messages into OpenAI Chat Completions `messages`. */
export function toOpenAIChatCompletionsMessages<TMeta = Record<string, unknown>>(
  history: Message<TMeta>[],
  options: ProviderMappingOptions<TMeta> = {},
): OpenAIChatCompletionsMessage[] {
  const messages: OpenAIChatCompletionsMessage[] = [];

  for (let i = 0; i < history.length; i += 1) {
    const message = history[i];
    if (!message) continue;
    if (message.role !== 'tool') {
      const mapped = toOpenAIChatCompletionsMessage(message, options);
      if (mapped) messages.push(mapped);
      continue;
    }

    const group: Message<TMeta>[] = [];
    while (i < history.length) {
      const next = history[i];
      if (!next || next.role !== 'tool') break;
      group.push(next);
      i += 1;
    }
    i -= 1;

    const providerTools: Array<{ message: Message<TMeta>; toolCall: OpenAIChatCompletionsToolCall }> = [];
    for (const toolMessage of group) {
      const toolCall = openAIChatToolCall(toolMessage as Message<unknown>);
      if (toolCall) providerTools.push({ message: toolMessage, toolCall });
    }

    if (providerTools.length) {
      appendOpenAIChatToolCalls(messages, providerTools.map(entry => entry.toolCall));
      for (const entry of providerTools) {
        const toolCallId = openAIToolCallId(entry.message as Message<unknown>);
        if (toolCallId) messages.push({ role: 'tool', tool_call_id: toolCallId, content: toolOutputText(entry.message) });
      }
    }

    for (const toolMessage of group) {
      if (openAIToolCallId(toolMessage as Message<unknown>)) continue;
      const mapped = toOpenAIChatCompletionsMessage(toolMessage, options);
      if (mapped) messages.push(mapped);
    }
  }

  return messages;
}

/** Build an OpenAI Chat Completions request body. Defaults `stream` to true. */
export function toOpenAIChatCompletionsBody<
  TMeta = Record<string, unknown>,
  TOptions extends OpenAIChatCompletionsBodyOptions<TMeta> = OpenAIChatCompletionsBodyOptions<TMeta>,
>(history: Message<TMeta>[], options?: TOptions): OpenAIChatCompletionsBody<TOptions> {
  const opts = (options ?? {}) as TOptions;
  const { bodyOptions, stream } = stripOpenAIChatOptions(opts);
  const body = {
    ...bodyOptions,
    messages: toOpenAIChatCompletionsMessages(history, opts),
    stream,
  };
  return body as OpenAIChatCompletionsBody<TOptions>;
}

/** JSON body formatter for `createFetchSSETransport(..., { formatBody })`. */
export function formatOpenAIChatCompletionsBody<TMeta = Record<string, unknown>>(
  options: OpenAIChatCompletionsBodyOptions<TMeta> = {},
) {
  return (_text: string, history: Message<TMeta>[]): string => JSON.stringify(toOpenAIChatCompletionsBody(history, options));
}
