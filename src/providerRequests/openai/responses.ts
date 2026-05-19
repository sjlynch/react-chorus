import type { Message } from '../../types';
import { openAIImageUrlFromAttachment, unsupportedAttachmentText } from '../attachments';
import { stripOpenAIResponsesOptions } from '../options';
import { compactJSONString, messageText, toolContextText, toolOutputText } from '../toolOutput';
import { forEachHistoryEntry } from '../toolRunIterator';
import type { ProviderMappingOptions } from '../types/common';
import type {
  OpenAIResponsesAssistantInputItem,
  OpenAIResponsesBody,
  OpenAIResponsesBodyOptions,
  OpenAIResponsesFunctionCallInputItem,
  OpenAIResponsesInputContentPart,
  OpenAIResponsesInputFilePart,
  OpenAIResponsesInputItem,
  OpenAIResponsesInputTextPart,
  OpenAIResponsesOutputTextPart,
  OpenAIResponsesSystemInputItem,
  OpenAIResponsesUserInputItem,
} from '../types/openaiResponses';
import { openAIToolCallId } from './shared';

function openAIResponsesFunctionCall(message: Message<unknown>): OpenAIResponsesFunctionCallInputItem | null {
  const callId = openAIToolCallId(message);
  if (!callId || !message.toolCall) return null;
  return {
    type: 'function_call',
    call_id: callId,
    name: message.toolCall.name || 'tool',
    arguments: compactJSONString(message.toolCall.input ?? {}),
  };
}

function openAIResponsesFilePart(attachment: { id?: string; url?: string }): OpenAIResponsesInputFilePart | null {
  if (typeof attachment.id === 'string' && attachment.id) {
    return { type: 'input_file', file_id: attachment.id };
  }
  if (typeof attachment.url === 'string' && attachment.url && !attachment.url.startsWith('data:')) {
    return { type: 'input_file', file_url: attachment.url };
  }
  return null;
}

function openAIResponsesInputContent<TMeta>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
): OpenAIResponsesInputContentPart[] {
  const parts: OpenAIResponsesInputContentPart[] = [];
  const text = messageText(message);
  if (text.trim()) parts.push({ type: 'input_text', text });

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

function openAIResponsesOutputContent<TMeta>(message: Message<TMeta>): OpenAIResponsesOutputTextPart[] {
  const parts: OpenAIResponsesOutputTextPart[] = [];
  const text = messageText(message);
  if (text.trim()) parts.push({ type: 'output_text', text });
  return parts;
}

function toOpenAIResponsesInputItem<TMeta>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
): OpenAIResponsesInputItem | null {
  if (message.role === 'system') {
    const content = openAIResponsesInputContent(message, options);
    if (!content.length) return null;
    const item: OpenAIResponsesSystemInputItem = { role: 'system', content };
    return item;
  }

  if (message.role === 'assistant') {
    const content = openAIResponsesOutputContent(message);
    if (!content.length) return null;
    const item: OpenAIResponsesAssistantInputItem = { role: 'assistant', content };
    return item;
  }

  if (message.role === 'user') {
    const content = openAIResponsesInputContent(message, options);
    if (!content.length) return null;
    const item: OpenAIResponsesUserInputItem = { role: 'user', content };
    return item;
  }

  if (message.role === 'tool') {
    const callId = openAIToolCallId(message as Message<unknown>);
    if (callId) return { type: 'function_call_output', call_id: callId, output: toolOutputText(message) };

    const text = toolContextText(message);
    if (!text) return null;
    const fallback: OpenAIResponsesSystemInputItem = {
      role: 'system',
      content: [{ type: 'input_text', text } as OpenAIResponsesInputTextPart],
    };
    return fallback;
  }

  return null;
}

/** Convert Chorus messages into OpenAI Responses API `input` items. */
export function toOpenAIResponsesInput<TMeta = Record<string, unknown>>(
  history: Message<TMeta>[],
  options: ProviderMappingOptions<TMeta> = {},
): OpenAIResponsesInputItem[] {
  const input: OpenAIResponsesInputItem[] = [];

  forEachHistoryEntry(history, {
    onMessage: message => {
      const mapped = toOpenAIResponsesInputItem(message, options);
      if (mapped) input.push(mapped);
    },
    onToolRun: run => {
      for (const toolMessage of run) {
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
    },
  });

  return input;
}

/** Build an OpenAI Responses API request body. Defaults `stream` to true. */
export function toOpenAIResponsesBody<
  TMeta = Record<string, unknown>,
  TOptions extends OpenAIResponsesBodyOptions<TMeta> = OpenAIResponsesBodyOptions<TMeta>,
>(history: Message<TMeta>[], options?: TOptions): OpenAIResponsesBody<TOptions> {
  const opts = (options ?? {}) as TOptions;
  const { bodyOptions, stream } = stripOpenAIResponsesOptions(opts);
  const body = {
    ...bodyOptions,
    input: toOpenAIResponsesInput(history, opts),
    stream,
  };
  return body as OpenAIResponsesBody<TOptions>;
}

/** JSON body formatter for `createFetchSSETransport(..., { formatBody })`. */
export function formatOpenAIResponsesBody<TMeta = Record<string, unknown>>(
  options: OpenAIResponsesBodyOptions<TMeta> = {},
) {
  return (_text: string, history: Message<TMeta>[]): string => JSON.stringify(toOpenAIResponsesBody(history, options));
}
