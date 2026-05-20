import type { Attachment, Message } from '../types';
import { dataUrlFromAttachment, resolveDataUrlMimeType, unsupportedAttachmentText } from './attachments';
import { metadataBoolean, metadataString } from './metadata';
import { resolveProviderSystem, stripAnthropicOptions } from './options';
import { messageText, objectToolInput, toolContextText, toolOutputText } from './toolOutput';
import { mapHistoryWithToolRuns } from './toolRunMapper';
import type { ProviderMappingOptions } from './types/common';
import type {
  AnthropicContentBlock,
  AnthropicDocumentBlock,
  AnthropicImageBlock,
  AnthropicMessage,
  AnthropicMessagesBody,
  AnthropicMessagesBodyOptions,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
} from './types/anthropic';

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

function anthropicToolResultBlock(message: Message<unknown>, toolUseId: string): AnthropicToolResultBlock {
  const block: AnthropicToolResultBlock = {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: toolOutputText(message),
  };
  if (anthropicToolResultIsError(message)) block.is_error = true;
  return block;
}

function anthropicToolUseBlock(message: Message<unknown>): AnthropicToolUseBlock | null {
  const id = anthropicToolUseId(message);
  if (!id || !message.toolCall) return null;
  return {
    type: 'tool_use',
    id,
    name: message.toolCall.name || 'tool',
    input: objectToolInput(message.toolCall.input),
  };
}

function appendAnthropicToolUseBlocks(target: AnthropicMessage[], blocks: AnthropicToolUseBlock[]) {
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

// The Anthropic Messages API accepts image blocks only for this MIME set. Any
// other `image/*` attachment (svg, bmp, tiff, heic, …) must fall through to an
// unsupported-attachment text block rather than a 400-producing image block.
const ANTHROPIC_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

function anthropicAttachmentBlock(attachment: Attachment): AnthropicImageBlock | AnthropicDocumentBlock | null {
  const dataUrl = dataUrlFromAttachment(attachment);
  if (!dataUrl) return null;
  const mimeType = resolveDataUrlMimeType(attachment, dataUrl);
  if (ANTHROPIC_IMAGE_MIME_TYPES.has(mimeType)) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data: dataUrl.base64 },
    };
  }
  if (mimeType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: dataUrl.base64 },
    };
  }
  return null;
}

function anthropicContentBlocks<TMeta>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  const text = messageText(message);
  if (text.trim()) blocks.push({ type: 'text', text });

  if (message.role === 'user') {
    for (const attachment of message.attachments ?? []) {
      const block = anthropicAttachmentBlock(attachment);
      if (block) {
        blocks.push(block);
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
  return mapHistoryWithToolRuns<TMeta, AnthropicToolUseBlock, AnthropicMessage>(history, {
    groupMode: 'all',
    mapMessage: message => toAnthropicMessage(message, options),
    extractToolBlock: message => anthropicToolUseBlock(message as Message<unknown>),
    emitToolGroup: (target, pairs) => {
      appendAnthropicToolUseBlocks(target, pairs.map(entry => entry.block));
      // Pair each tool_result with its tool_use block's own id rather than
      // re-resolving from metadata: the block only exists because the id
      // resolved non-empty, so this can never emit the empty tool_use_id
      // (Anthropic rejects empty ids) the prior `?? ''` fallback allowed.
      target.push({
        role: 'user',
        content: pairs.map(entry => anthropicToolResultBlock(
          entry.message as Message<unknown>,
          entry.block.id,
        )),
      });
    },
    fallback: message => {
      if (anthropicToolUseId(message as Message<unknown>)) return null;
      return toAnthropicMessage(message, options);
    },
  });
}

/** Build an Anthropic Messages API request body. Defaults `stream` to true. */
export function toAnthropicMessagesBody<
  TMeta = Record<string, unknown>,
  TOptions extends AnthropicMessagesBodyOptions<TMeta> = AnthropicMessagesBodyOptions<TMeta>,
>(history: Message<TMeta>[], options?: TOptions): AnthropicMessagesBody<TOptions> {
  const opts = (options ?? {}) as TOptions;
  const { bodyOptions, stream, system: callerSystem } = stripAnthropicOptions(opts);
  // A caller-supplied `system` wins over history-derived system text
  // (documented precedence); a dev warn-once fires when both are present.
  const system = resolveProviderSystem(
    'Anthropic',
    'system',
    callerSystem,
    anthropicSystem(history as Message<unknown>[]),
  );
  const body = {
    ...bodyOptions,
    ...(system ? { system } : {}),
    messages: toAnthropicMessages(history, opts),
    stream,
  };
  return body as AnthropicMessagesBody<TOptions>;
}

/** JSON body formatter for `createFetchSSETransport(..., { formatBody })`. */
export function formatAnthropicMessagesBody<TMeta = Record<string, unknown>>(
  options: AnthropicMessagesBodyOptions<TMeta> = {},
) {
  return (_text: string, history: Message<TMeta>[]): string => JSON.stringify(toAnthropicMessagesBody(history, options));
}
