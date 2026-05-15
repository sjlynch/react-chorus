import type { Attachment, Message } from './types';

export type UnsupportedAttachmentText<TMeta = Record<string, unknown>> = (
  attachment: Attachment,
  message: Message<TMeta>,
) => string;

export interface ProviderMappingOptions<TMeta = Record<string, unknown>> {
  /** Override the text block inserted when an attachment cannot be represented in the provider schema. */
  unsupportedAttachmentText?: UnsupportedAttachmentText<TMeta>;
}

export interface OpenAIChatCompletionsBodyOptions<TMeta = Record<string, unknown>> extends ProviderMappingOptions<TMeta> {
  model?: string;
  stream?: boolean;
  [key: string]: unknown;
}

export interface OpenAIResponsesBodyOptions<TMeta = Record<string, unknown>> extends ProviderMappingOptions<TMeta> {
  model?: string;
  stream?: boolean;
  [key: string]: unknown;
}

export interface AnthropicMessagesBodyOptions<TMeta = Record<string, unknown>> extends ProviderMappingOptions<TMeta> {
  model?: string;
  max_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
}

export interface GeminiGenerateContentBodyOptions<TMeta = Record<string, unknown>> extends ProviderMappingOptions<TMeta> {
  [key: string]: unknown;
}

export type OpenAIChatCompletionsMessage = Record<string, unknown>;
export type OpenAIResponsesInputItem = Record<string, unknown>;
export type AnthropicMessage = Record<string, unknown>;
export type GeminiContent = Record<string, unknown>;

export interface OpenAIChatCompletionsBody extends Record<string, unknown> {
  messages: OpenAIChatCompletionsMessage[];
  stream: boolean;
}

export interface OpenAIResponsesBody extends Record<string, unknown> {
  input: OpenAIResponsesInputItem[];
  stream: boolean;
}

export interface AnthropicMessagesBody extends Record<string, unknown> {
  messages: AnthropicMessage[];
  stream: boolean;
  system?: string;
}

export interface GeminiGenerateContentBody extends Record<string, unknown> {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function messageText(message: Message<unknown>): string {
  return message.text ?? '';
}

function defaultUnsupportedAttachmentText(attachment: Attachment): string {
  const name = attachment.name || 'attachment';
  const type = attachment.type ? ` (${attachment.type})` : '';
  return `[Unsupported attachment omitted: ${name}${type}]`;
}

function unsupportedAttachmentText<TMeta>(
  attachment: Attachment,
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
) {
  return options.unsupportedAttachmentText?.(attachment, message) ?? defaultUnsupportedAttachmentText(attachment);
}

function parseDataUrl(value: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/i.exec(value);
  if (!match) return null;
  return { mimeType: match[1] || 'application/octet-stream', base64: match[2] || '' };
}

function isOpenAIImageUrl(value: string) {
  return /^(data:|https?:\/\/)/i.test(value);
}

function openAIImageUrlFromAttachment(attachment: Attachment) {
  const candidates = [attachment.url, attachment.data];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate && isOpenAIImageUrl(candidate)) return candidate;
  }
  return null;
}

function dataUrlFromAttachment(attachment: Attachment) {
  const data = typeof attachment.data === 'string' ? attachment.data : '';
  return data ? parseDataUrl(data) : null;
}

function fileUriFromAttachment(attachment: Attachment) {
  for (const candidate of [attachment.url, attachment.id, attachment.data]) {
    if (typeof candidate === 'string' && candidate && !candidate.startsWith('data:')) return candidate;
  }
  return null;
}

function metadataRecord(message: Message<unknown>) {
  return isRecord(message.metadata) ? message.metadata : undefined;
}

function nestedRecord(record: Record<string, unknown> | undefined, key: string) {
  const nested = record?.[key];
  return isRecord(nested) ? nested : undefined;
}

function metadataString(
  message: Message<unknown>,
  providerKey: string,
  providerKeys: string[],
  rootKeys: string[],
) {
  const metadata = metadataRecord(message);
  const provider = nestedRecord(metadata, providerKey);

  for (const key of providerKeys) {
    const value = nonEmptyString(provider?.[key]);
    if (value) return value;
  }

  for (const key of rootKeys) {
    const value = nonEmptyString(metadata?.[key]);
    if (value) return value;
  }

  return null;
}

function metadataArray(
  message: Message<unknown>,
  providerKey: string,
  providerKeys: string[],
  rootKeys: string[],
) {
  const metadata = metadataRecord(message);
  const provider = nestedRecord(metadata, providerKey);

  for (const key of providerKeys) {
    const value = provider?.[key];
    if (Array.isArray(value)) return value;
  }

  for (const key of rootKeys) {
    const value = metadata?.[key];
    if (Array.isArray(value)) return value;
  }

  return null;
}

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

function anthropicToolUseId(message: Message<unknown>) {
  return metadataString(message, 'anthropic', ['toolUseId', 'tool_use_id'], [
    'anthropicToolUseId',
    'anthropic_tool_use_id',
    'toolUseId',
    'tool_use_id',
    'providerToolUseId',
  ]);
}

function toolOutputValue<TMeta>(message: Message<TMeta>) {
  const rawText = messageText(message);
  if (message.toolCall && hasOwn(message.toolCall, 'output')) return message.toolCall.output;
  const text = rawText.trim();
  return text ? rawText : message.toolCall?.input;
}

function toolOutputText<TMeta>(message: Message<TMeta>) {
  const text = messageText(message).trim();
  const rendered = safeStringify(toolOutputValue(message));
  return rendered || text;
}

function compactJSONString(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {}) ?? '{}';
  } catch {
    return safeStringify(value ?? {});
  }
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
  if (last?.role === 'assistant') {
    const existing = Array.isArray(last.tool_calls) ? last.tool_calls : [];
    last.content = hasOwn(last, 'content') ? last.content : null;
    last.tool_calls = existing.concat(toolCalls);
    return;
  }

  target.push({ role: 'assistant', content: null, tool_calls: toolCalls });
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

function anthropicToolInput(value: unknown) {
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

function anthropicToolUseBlock(message: Message<unknown>) {
  const id = anthropicToolUseId(message);
  if (!id || !message.toolCall) return null;
  return {
    type: 'tool_use',
    id,
    name: message.toolCall.name || 'tool',
    input: anthropicToolInput(message.toolCall.input),
  };
}

function appendAnthropicToolUseBlocks(target: AnthropicMessage[], blocks: AnthropicMessage[]) {
  const last = target[target.length - 1];
  if (last?.role === 'assistant' && Array.isArray(last.content)) {
    last.content = last.content.concat(blocks);
    return;
  }

  target.push({ role: 'assistant', content: blocks });
}

function toolContextText<TMeta>(message: Message<TMeta>) {
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

function stripOpenAIChatOptions<TMeta>(options: OpenAIChatCompletionsBodyOptions<TMeta>) {
  const { unsupportedAttachmentText: _unsupportedAttachmentText, stream = true, ...bodyOptions } = options;
  void _unsupportedAttachmentText;
  return { bodyOptions, stream };
}

function stripOpenAIResponsesOptions<TMeta>(options: OpenAIResponsesBodyOptions<TMeta>) {
  const { unsupportedAttachmentText: _unsupportedAttachmentText, stream = true, ...bodyOptions } = options;
  void _unsupportedAttachmentText;
  return { bodyOptions, stream };
}

function stripAnthropicOptions<TMeta>(options: AnthropicMessagesBodyOptions<TMeta>) {
  const { unsupportedAttachmentText: _unsupportedAttachmentText, stream = true, ...bodyOptions } = options;
  void _unsupportedAttachmentText;
  return { bodyOptions, stream };
}

function stripGeminiOptions<TMeta>(options: GeminiGenerateContentBodyOptions<TMeta>) {
  const { unsupportedAttachmentText: _unsupportedAttachmentText, ...bodyOptions } = options;
  void _unsupportedAttachmentText;
  return bodyOptions;
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
      const imageUrl = attachment.type.startsWith('image/') ? openAIImageUrlFromAttachment(attachment) : null;
      if (imageUrl) {
        parts.push({ type: 'input_image', image_url: imageUrl });
      } else {
        parts.push({ type: 'input_text', text: unsupportedAttachmentText(attachment, message, options) });
      }
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

function anthropicSystem(history: Message<unknown>[]) {
  const system = history
    .filter(message => message.role === 'system' && message.text.trim())
    .map(message => message.text)
    .join('\n\n');
  return system || undefined;
}

function anthropicContentBlocks<TMeta>(message: Message<TMeta>, options: ProviderMappingOptions<TMeta>) {
  const blocks: Array<Record<string, unknown>> = [];
  const text = messageText(message);
  if (text.trim()) blocks.push({ type: 'text', text });

  if (message.role === 'user') {
    for (const attachment of message.attachments ?? []) {
      const dataUrl = attachment.type.startsWith('image/') ? dataUrlFromAttachment(attachment) : null;
      if (dataUrl) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: attachment.type || dataUrl.mimeType, data: dataUrl.base64 },
        });
      } else {
        blocks.push({ type: 'text', text: unsupportedAttachmentText(attachment, message, options) });
      }
    }
  }

  return blocks;
}

function toAnthropicMessage<TMeta>(message: Message<TMeta>, options: ProviderMappingOptions<TMeta>): AnthropicMessage | null {
  if (message.role === 'system') return null;

  if (message.role === 'assistant') {
    const content = anthropicContentBlocks(message, options);
    return content.length ? { role: 'assistant', content } : null;
  }

  if (message.role === 'user') {
    const content = anthropicContentBlocks(message, options);
    return content.length ? { role: 'user', content } : null;
  }

  if (message.role === 'tool') {
    const toolUseId = anthropicToolUseId(message as Message<unknown>);
    if (toolUseId) {
      return { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: toolOutputText(message) }] };
    }

    const text = toolContextText(message);
    return text ? { role: 'user', content: [{ type: 'text', text }] } : null;
  }

  return null;
}

function geminiSystemInstruction(history: Message<unknown>[]) {
  const system = history
    .filter(message => message.role === 'system' && message.text.trim())
    .map(message => message.text)
    .join('\n\n');
  return system ? { parts: [{ text: system }] } : undefined;
}

function geminiParts<TMeta>(message: Message<TMeta>, options: ProviderMappingOptions<TMeta>) {
  const parts: Array<Record<string, unknown>> = [];
  const text = messageText(message);
  if (text.trim()) parts.push({ text });

  if (message.role === 'user') {
    for (const attachment of message.attachments ?? []) {
      if (attachment.type.startsWith('image/')) {
        const dataUrl = dataUrlFromAttachment(attachment);
        if (dataUrl) {
          parts.push({ inlineData: { mimeType: attachment.type || dataUrl.mimeType, data: dataUrl.base64 } });
          continue;
        }

        const fileUri = fileUriFromAttachment(attachment);
        if (fileUri) {
          parts.push({ fileData: { mimeType: attachment.type || 'application/octet-stream', fileUri } });
          continue;
        }
      }

      parts.push({ text: unsupportedAttachmentText(attachment, message, options) });
    }
  }

  return parts;
}

function geminiFunctionResponsePayload(value: unknown) {
  if (isRecord(value)) return value;
  if (typeof value === 'string') return { content: value };
  return { content: safeStringify(value) };
}

function toGeminiContent<TMeta>(message: Message<TMeta>, options: ProviderMappingOptions<TMeta>): GeminiContent | null {
  if (message.role === 'system') return null;

  if (message.role === 'assistant') {
    const parts = geminiParts(message, options);
    return parts.length ? { role: 'model', parts } : null;
  }

  if (message.role === 'user') {
    const parts = geminiParts(message, options);
    return parts.length ? { role: 'user', parts } : null;
  }

  if (message.role === 'tool') {
    const name = message.toolCall?.name;
    if (name) {
      const text = messageText(message);
      const value = message.toolCall.output ?? (text.trim() ? text : message.toolCall.input);
      return {
        role: 'user',
        parts: [{ functionResponse: { name, response: geminiFunctionResponsePayload(value) } }],
      };
    }

    const text = toolContextText(message);
    return text ? { role: 'user', parts: [{ text }] } : null;
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

/** Convert Chorus messages into Anthropic Messages API `messages`. System messages are returned by `toAnthropicMessagesBody().system`. */
export function toAnthropicMessages<TMeta = Record<string, unknown>>(
  history: Message<TMeta>[],
  options: ProviderMappingOptions<TMeta> = {},
): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];

  for (let i = 0; i < history.length; i += 1) {
    const message = history[i];
    if (message.role !== 'tool') {
      const mapped = toAnthropicMessage(message, options);
      if (mapped) messages.push(mapped);
      continue;
    }

    const group: Message<TMeta>[] = [];
    while (i < history.length && history[i].role === 'tool') {
      group.push(history[i]);
      i += 1;
    }
    i -= 1;

    const providerTools: Array<{ message: Message<TMeta>; block: AnthropicMessage }> = [];
    for (const toolMessage of group) {
      const block = anthropicToolUseBlock(toolMessage as Message<unknown>);
      if (block) providerTools.push({ message: toolMessage, block });
    }

    if (providerTools.length) {
      appendAnthropicToolUseBlocks(messages, providerTools.map(entry => entry.block));
      messages.push({
        role: 'user',
        content: providerTools.map(entry => ({
          type: 'tool_result',
          tool_use_id: anthropicToolUseId(entry.message as Message<unknown>),
          content: toolOutputText(entry.message),
        })),
      });
    }

    for (const toolMessage of group) {
      if (anthropicToolUseId(toolMessage as Message<unknown>)) continue;
      const mapped = toAnthropicMessage(toolMessage, options);
      if (mapped) messages.push(mapped);
    }
  }

  return messages;
}

/** Build an Anthropic Messages API request body. Defaults `stream` to true. */
export function toAnthropicMessagesBody<TMeta = Record<string, unknown>>(
  history: Message<TMeta>[],
  options: AnthropicMessagesBodyOptions<TMeta> = {},
): AnthropicMessagesBody {
  const { bodyOptions, stream } = stripAnthropicOptions(options);
  const system = anthropicSystem(history as Message<unknown>[]);
  return {
    ...bodyOptions,
    ...(system ? { system } : {}),
    messages: toAnthropicMessages(history, options),
    stream,
  };
}

/** JSON body formatter for `createFetchSSETransport(..., { formatBody })`. */
export function formatAnthropicMessagesBody<TMeta = Record<string, unknown>>(
  options: AnthropicMessagesBodyOptions<TMeta> = {},
) {
  return (_text: string, history: Message<TMeta>[]): string => JSON.stringify(toAnthropicMessagesBody(history, options));
}

/** Convert Chorus messages into Gemini `contents`. System messages are returned by `toGeminiGenerateContentBody().systemInstruction`. */
export function toGeminiContents<TMeta = Record<string, unknown>>(
  history: Message<TMeta>[],
  options: ProviderMappingOptions<TMeta> = {},
): GeminiContent[] {
  return history
    .map(message => toGeminiContent(message, options))
    .filter((content): content is GeminiContent => Boolean(content));
}

/** Build a Gemini generateContent request body. Use it with a streaming Gemini endpoint and `connector="gemini"`. */
export function toGeminiGenerateContentBody<TMeta = Record<string, unknown>>(
  history: Message<TMeta>[],
  options: GeminiGenerateContentBodyOptions<TMeta> = {},
): GeminiGenerateContentBody {
  const bodyOptions = stripGeminiOptions(options);
  const systemInstruction = geminiSystemInstruction(history as Message<unknown>[]);
  return {
    ...bodyOptions,
    ...(systemInstruction ? { systemInstruction } : {}),
    contents: toGeminiContents(history, options),
  };
}

/** JSON body formatter for `createFetchSSETransport(..., { formatBody })`. */
export function formatGeminiGenerateContentBody<TMeta = Record<string, unknown>>(
  options: GeminiGenerateContentBodyOptions<TMeta> = {},
) {
  return (_text: string, history: Message<TMeta>[]): string => JSON.stringify(toGeminiGenerateContentBody(history, options));
}
