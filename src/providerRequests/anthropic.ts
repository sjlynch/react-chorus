import type { Message } from '../types';
import { dataUrlFromAttachment, unsupportedAttachmentText } from './attachments';
import { metadataBoolean, metadataString } from './metadata';
import { stripAnthropicOptions } from './options';
import { messageText, objectToolInput, toolContextText, toolOutputText } from './toolOutput';
import type { AnthropicMessage, AnthropicMessagesBody, AnthropicMessagesBodyOptions, ProviderMappingOptions } from './types';

function anthropicToolUseId(message: Message<unknown>) {
  return metadataString(message, 'anthropic', ['toolUseId', 'tool_use_id'], [
    'anthropicToolUseId',
    'anthropic_tool_use_id',
    'toolUseId',
    'tool_use_id',
    'providerToolUseId',
  ]);
}

function anthropicToolResultIsError(message: Message<unknown>) {
  return metadataBoolean(message, 'anthropic', ['isError', 'is_error'], ['isError', 'is_error']);
}

function anthropicToolResultBlock(message: Message<unknown>, toolUseId: string) {
  const block: Record<string, unknown> = {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: toolOutputText(message),
  };
  if (anthropicToolResultIsError(message)) block.is_error = true;
  return block;
}

function anthropicToolUseBlock(message: Message<unknown>) {
  const id = anthropicToolUseId(message);
  if (!id || !message.toolCall) return null;
  return {
    type: 'tool_use',
    id,
    name: message.toolCall.name || 'tool',
    input: objectToolInput(message.toolCall.input),
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
      return { role: 'user', content: [anthropicToolResultBlock(message as Message<unknown>, toolUseId)] };
    }

    const text = toolContextText(message);
    return text ? { role: 'user', content: [{ type: 'text', text }] } : null;
  }

  return null;
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
        content: providerTools.map(entry => anthropicToolResultBlock(
          entry.message as Message<unknown>,
          anthropicToolUseId(entry.message as Message<unknown>) as string,
        )),
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
