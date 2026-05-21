import type { Attachment, Message } from '../../types';
import { isOpenAIImageAttachment, openAIImageUrlFromAttachment } from '../attachments';
import { messageContentParts, messageTextParts } from '../contentParts';
import { stripOpenAIResponsesOptions } from '../options';
import { toolContextText, toolOutputText } from '../toolOutput';
import { mapHistoryWithToolRuns } from '../toolRunMapper';
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
import { openAIToolCallArguments, openAIToolCallId, resolveOpenAIToolCallId } from './shared';

function openAIResponsesFunctionCall(message: Message<unknown>): OpenAIResponsesFunctionCallInputItem | null {
  if (!message.toolCall) return null;
  // Always emit the function_call: when metadata carries no call id,
  // resolveOpenAIToolCallId synthesizes a best-effort one rather than dropping
  // the assistant tool call.
  return {
    type: 'function_call',
    call_id: resolveOpenAIToolCallId(message),
    name: message.toolCall.name || 'tool',
    arguments: openAIToolCallArguments(message.toolCall.input),
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

function openAIResponsesAttachmentPart(attachment: Attachment): OpenAIResponsesInputContentPart | null {
  if (isOpenAIImageAttachment(attachment)) {
    const imageUrl = openAIImageUrlFromAttachment(attachment);
    return imageUrl ? { type: 'input_image', image_url: imageUrl } : null;
  }

  return openAIResponsesFilePart(attachment);
}

function openAIResponsesInputContent<TMeta>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
): OpenAIResponsesInputContentPart[] {
  return messageContentParts<TMeta, OpenAIResponsesInputContentPart>(message, options, {
    createTextPart: text => ({ type: 'input_text', text }),
    mapAttachment: openAIResponsesAttachmentPart,
  });
}

function openAIResponsesOutputContent<TMeta>(message: Message<TMeta>): OpenAIResponsesOutputTextPart[] {
  return messageTextParts(message, text => ({ type: 'output_text', text }));
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
  return mapHistoryWithToolRuns<TMeta, OpenAIResponsesFunctionCallInputItem, OpenAIResponsesInputItem>(history, {
    groupMode: 'contiguous',
    mapMessage: message => toOpenAIResponsesInputItem(message, options),
    extractToolBlock: message => openAIResponsesFunctionCall(message as Message<unknown>),
    emitToolGroup: (target, pairs) => {
      for (const entry of pairs) {
        target.push(entry.block);
        // Pair the output with the function_call's own call_id so the two
        // always reference each other, even when the id was synthesized.
        target.push({ type: 'function_call_output', call_id: entry.block.call_id, output: toolOutputText(entry.message) });
      }
    },
    fallback: message => toOpenAIResponsesInputItem(message, options),
  });
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
