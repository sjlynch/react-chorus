import type { Message } from '../types';
import { openAIImageUrlFromAttachment, unsupportedAttachmentText } from './attachments';
import { hasOwn, isRecord, metadataArray, metadataString, nonEmptyString } from './metadata';
import { stripOpenAIChatOptions, stripOpenAIResponsesOptions } from './options';
import { compactJSONString, messageText, toolContextText, toolOutputText } from './toolOutput';
import type {
  OpenAIChatCompletionsBody,
  OpenAIChatCompletionsBodyOptions,
  OpenAIChatCompletionsMessage,
  OpenAIResponsesBody,
  OpenAIResponsesBodyOptions,
  OpenAIResponsesInputItem,
  ProviderMappingOptions,
} from './types';

function openAIToolCallId(message: Message<unknown>) {
  return metadataString(message, 'openai', ['toolCallId', 'tool_call_id', 'callId', 'call_id'], [
    'openaiToolCallId',
    'openai_tool_call_id',
    'toolCallId',
    'tool_call_id',
    'callId',
    'call_id',
    'providerToolCallId',
  ]);
}

function openAIAssistantToolCalls(message: Message<unknown>) {
  return metadataArray(message, 'openai', ['toolCalls', 'tool_calls'], ['openaiToolCalls', 'openai_tool_calls', 'toolCalls', 'tool_calls']);
}

function openAIChatToolCallIdFromValue(value: unknown) {
  return isRecord(value) ? nonEmptyString(value.id) : null;
}

function openAIChatToolCall(message: Message<unknown>) {
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

function appendOpenAIChatToolCalls(target: OpenAIChatCompletionsMessage[], toolCalls: OpenAIChatCompletionsMessage[]) {
  const last = target[target.length - 1];
  const existing = last?.role === 'assistant' && Array.isArray(last.tool_calls) ? last.tool_calls : [];
  const seenIds = new Set<string>();

  for (const toolCall of existing) {
    const id = openAIChatToolCallIdFromValue(toolCall);
    if (id) seenIds.add(id);
  }

  const dedupedToolCalls: OpenAIChatCompletionsMessage[] = [];
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

function openAIResponsesFunctionCall(message: Message<unknown>) {
  const callId = openAIToolCallId(message);
  if (!callId || !message.toolCall) return null;
  return {
    type: 'function_call',
    call_id: callId,
    name: message.toolCall.name || 'tool',
    arguments: compactJSONString(message.toolCall.input ?? {}),
  };
}

function openAIChatUserContent<TMeta>(message: Message<TMeta>, options: ProviderMappingOptions<TMeta>) {
  const parts: Array<Record<string, unknown>> = [];
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
  return parts.length === 1 && parts[0]?.type === 'text' ? parts[0].text : parts;
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
    return toolCalls?.length
      ? { role: 'assistant', content: hasText ? message.text : null, tool_calls: toolCalls }
      : { role: 'assistant', content: message.text };
  }

  if (message.role === 'user') {
    const content = openAIChatUserContent(message, options);
    return content ? { role: 'user', content } : null;
  }

  if (message.role === 'tool') {
    const toolCallId = openAIToolCallId(message as Message<unknown>);
    if (toolCallId) return { role: 'tool', tool_call_id: toolCallId, content: toolOutputText(message) };

    const content = toolContextText(message);
    return content ? { role: 'system', content } : null;
  }

  return null;
}

function openAIResponsesFilePart(attachment: { id?: string; url?: string }): Record<string, unknown> | null {
  if (typeof attachment.id === 'string' && attachment.id) {
    return { type: 'input_file', file_id: attachment.id };
  }
  if (typeof attachment.url === 'string' && attachment.url && !attachment.url.startsWith('data:')) {
    return { type: 'input_file', file_url: attachment.url };
  }
  return null;
}

function openAIResponsesContent<TMeta>(
  message: Message<TMeta>,
  textType: 'input_text' | 'output_text',
  options: ProviderMappingOptions<TMeta>,
) {
  const parts: Array<Record<string, unknown>> = [];
  const text = messageText(message);
  if (text.trim()) parts.push({ type: textType, text });

  if (message.role === 'user') {
    for (const attachment of message.attachments ?? []) {
      if (attachment.type.startsWith('image/')) {
        const imageUrl = openAIImageUrlFromAttachment(attachment);
        if (imageUrl) {
          parts.push({ type: 'input_image', image_url: imageUrl });
          continue;
        }
      } else {
        const filePart = openAIResponsesFilePart(attachment);
        if (filePart) {
          parts.push(filePart);
          continue;
        }
      }

      parts.push({ type: 'input_text', text: unsupportedAttachmentText(attachment, message, options) });
    }
  }

  return parts;
}

function toOpenAIResponsesInputItem<TMeta>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
): OpenAIResponsesInputItem | null {
  if (message.role === 'system') {
    const content = openAIResponsesContent(message, 'input_text', options);
    return content.length ? { role: 'system', content } : null;
  }

  if (message.role === 'assistant') {
    const content = openAIResponsesContent(message, 'output_text', options);
    return content.length ? { role: 'assistant', content } : null;
  }

  if (message.role === 'user') {
    const content = openAIResponsesContent(message, 'input_text', options);
    return content.length ? { role: 'user', content } : null;
  }

  if (message.role === 'tool') {
    const callId = openAIToolCallId(message as Message<unknown>);
    if (callId) return { type: 'function_call_output', call_id: callId, output: toolOutputText(message) };

    const text = toolContextText(message);
    return text ? { role: 'system', content: [{ type: 'input_text', text }] } : null;
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
    if (message.role !== 'tool') {
      const mapped = toOpenAIChatCompletionsMessage(message, options);
      if (mapped) messages.push(mapped);
      continue;
    }

    const group: Message<TMeta>[] = [];
    while (i < history.length && history[i].role === 'tool') {
      group.push(history[i]);
      i += 1;
    }
    i -= 1;

    const providerTools: Array<{ message: Message<TMeta>; toolCall: OpenAIChatCompletionsMessage }> = [];
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
export function toOpenAIChatCompletionsBody<TMeta = Record<string, unknown>>(
  history: Message<TMeta>[],
  options: OpenAIChatCompletionsBodyOptions<TMeta> = {},
): OpenAIChatCompletionsBody {
  const { bodyOptions, stream } = stripOpenAIChatOptions(options);
  return {
    ...bodyOptions,
    messages: toOpenAIChatCompletionsMessages(history, options),
    stream,
  };
}

/** JSON body formatter for `createFetchSSETransport(..., { formatBody })`. */
export function formatOpenAIChatCompletionsBody<TMeta = Record<string, unknown>>(
  options: OpenAIChatCompletionsBodyOptions<TMeta> = {},
) {
  return (_text: string, history: Message<TMeta>[]): string => JSON.stringify(toOpenAIChatCompletionsBody(history, options));
}

/** Convert Chorus messages into OpenAI Responses API `input` items. */
export function toOpenAIResponsesInput<TMeta = Record<string, unknown>>(
  history: Message<TMeta>[],
  options: ProviderMappingOptions<TMeta> = {},
): OpenAIResponsesInputItem[] {
  const input: OpenAIResponsesInputItem[] = [];

  for (let i = 0; i < history.length; i += 1) {
    const message = history[i];
    if (message.role !== 'tool') {
      const mapped = toOpenAIResponsesInputItem(message, options);
      if (mapped) input.push(mapped);
      continue;
    }

    const group: Message<TMeta>[] = [];
    while (i < history.length && history[i].role === 'tool') {
      group.push(history[i]);
      i += 1;
    }
    i -= 1;

    for (const toolMessage of group) {
      const functionCall = openAIResponsesFunctionCall(toolMessage as Message<unknown>);
      if (functionCall) {
        const callId = openAIToolCallId(toolMessage as Message<unknown>);
        input.push(functionCall);
        if (callId) input.push({ type: 'function_call_output', call_id: callId, output: toolOutputText(toolMessage) });
        continue;
      }

      const mapped = toOpenAIResponsesInputItem(toolMessage, options);
      if (mapped) input.push(mapped);
    }
  }

  return input;
}

/** Build an OpenAI Responses API request body. Defaults `stream` to true. */
export function toOpenAIResponsesBody<TMeta = Record<string, unknown>>(
  history: Message<TMeta>[],
  options: OpenAIResponsesBodyOptions<TMeta> = {},
): OpenAIResponsesBody {
  const { bodyOptions, stream } = stripOpenAIResponsesOptions(options);
  return {
    ...bodyOptions,
    input: toOpenAIResponsesInput(history, options),
    stream,
  };
}

/** JSON body formatter for `createFetchSSETransport(..., { formatBody })`. */
export function formatOpenAIResponsesBody<TMeta = Record<string, unknown>>(
  options: OpenAIResponsesBodyOptions<TMeta> = {},
) {
  return (_text: string, history: Message<TMeta>[]): string => JSON.stringify(toOpenAIResponsesBody(history, options));
}
