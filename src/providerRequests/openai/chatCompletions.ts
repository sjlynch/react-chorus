import type { Attachment, Message } from '../../types';
import { isOpenAIImageAttachment, openAIImageDetail, openAIImageUrlFromAttachment } from '../attachments';
import { messageContentParts } from '../contentParts';
import { hasOwn, isRecord, metadataArray, nonEmptyString } from '../metadata';
import { stripOpenAIChatOptions } from '../options';
import { toolContextText, toolOutputText } from '../toolOutput';
import { mapHistoryWithToolRuns } from '../toolRunMapper';
import type { ProviderMappingOptions } from '../types/common';
import type {
  OpenAIChatCompletionsAssistantMessage,
  OpenAIChatCompletionsBody,
  OpenAIChatCompletionsBodyOptions,
  OpenAIChatCompletionsMessage,
  OpenAIChatCompletionsTextPart,
  OpenAIChatCompletionsToolCall,
  OpenAIChatCompletionsUserContentPart,
} from '../types/openaiChat';
import { openAIToolCallArguments, openAIToolCallId, resolveOpenAIToolCallId } from './shared';

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
  if (!message.toolCall) return null;
  // Always emit the tool_call: when metadata carries no call id,
  // resolveOpenAIToolCallId synthesizes a best-effort one rather than dropping
  // the assistant tool call.
  return {
    id: resolveOpenAIToolCallId(message),
    type: 'function',
    function: {
      name: message.toolCall.name || 'tool',
      arguments: openAIToolCallArguments(message.toolCall.input),
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

function openAIChatAttachmentPart(attachment: Attachment): OpenAIChatCompletionsUserContentPart | null {
  const imageUrl = isOpenAIImageAttachment(attachment) ? openAIImageUrlFromAttachment(attachment) : null;
  if (!imageUrl) return null;
  const detail = openAIImageDetail(attachment);
  return { type: 'image_url', image_url: { url: imageUrl, ...(detail ? { detail } : {}) } };
}

function openAIChatUserContent<TMeta>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
): string | OpenAIChatCompletionsUserContentPart[] | null {
  const parts = messageContentParts<TMeta, OpenAIChatCompletionsUserContentPart>(message, options, {
    provider: 'OpenAI Chat Completions',
    createTextPart: text => ({ type: 'text', text }),
    mapAttachment: openAIChatAttachmentPart,
  });

  if (!parts.length) return null;
  const single = parts[0];
  return parts.length === 1 && single && single.type === 'text' ? single.text : parts;
}

function openAIChatAssistantContent<TMeta>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
): string {
  // Route assistant content through `messageContentParts` (no `mapAttachment`):
  // Chat Completions does not accept image/file parts in an assistant turn, so
  // an attachment carried on an assistant message surfaces as the observable
  // unsupported-attachment text block (with a dev warning) joined into the
  // assistant `content` string instead of being silently dropped.
  const parts = messageContentParts<TMeta, OpenAIChatCompletionsTextPart>(message, options, {
    provider: 'OpenAI Chat Completions',
    createTextPart: text => ({ type: 'text', text }),
  });
  return parts.map(part => part.text).join('\n\n');
}

function toOpenAIChatCompletionsMessage<TMeta>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
): OpenAIChatCompletionsMessage | null {
  if (message.role === 'system') {
    // Emit the trimmed text so Chat Completions matches the other mappers:
    // the Responses, Anthropic, and Gemini mappers route system text through
    // `messageTextParts`, which trims, so all four serialize identically.
    const trimmed = message.text.trim();
    return trimmed ? { role: 'system', content: trimmed } : null;
  }

  if (message.role === 'assistant') {
    const toolCalls = openAIAssistantToolCalls(message as Message<unknown>);
    const content = openAIChatAssistantContent(message, options);
    const hasText = Boolean(content);
    if (!hasText && !toolCalls?.length) return null;
    const assistant: OpenAIChatCompletionsAssistantMessage = toolCalls?.length
      ? { role: 'assistant', content: hasText ? content : null, tool_calls: toolCalls }
      : { role: 'assistant', content };
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
  return mapHistoryWithToolRuns<TMeta, OpenAIChatCompletionsToolCall, OpenAIChatCompletionsMessage>(history, {
    groupMode: 'all',
    mapMessage: message => toOpenAIChatCompletionsMessage(message, options),
    extractToolBlock: message => openAIChatToolCall(message as Message<unknown>),
    emitToolGroup: (target, pairs) => {
      appendOpenAIChatToolCalls(target, pairs.map(entry => entry.block));
      for (const entry of pairs) {
        // Pair the tool result with the tool_call's own id so the two always
        // reference each other, even when the id was synthesized.
        target.push({ role: 'tool', tool_call_id: entry.block.id, content: toolOutputText(entry.message) });
      }
    },
    fallback: message => {
      if (openAIToolCallId(message as Message<unknown>)) return null;
      return toOpenAIChatCompletionsMessage(message, options);
    },
  });
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
