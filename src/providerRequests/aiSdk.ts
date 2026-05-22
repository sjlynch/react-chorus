import type { Attachment, Message, ToolMessage } from '../types';
import { dataUrlFromAttachment, resolveDataUrlMimeType } from './attachments';
import { messageContentParts } from './contentParts';
import { hasOwn, metadataBoolean, metadataString, nonEmptyString } from './metadata';
import { warnOnceInDev } from './devWarn';
import { safeStringify, toolContextText, toolOutputValue } from './toolOutput';
import { mapHistoryWithToolRuns } from './toolRunMapper';
import type { ProviderMappingOptions } from './types/common';
import type {
  AiSdkAssistantContentPart,
  AiSdkDataContent,
  AiSdkFilePart,
  AiSdkImagePart,
  AiSdkJsonValue,
  AiSdkModelMessage,
  AiSdkModelMessagesBody,
  AiSdkModelMessagesBodyOptions,
  AiSdkTextPart,
  AiSdkToolCallPart,
  AiSdkToolResultOutput,
  AiSdkToolResultPart,
  AiSdkUserContentPart,
} from './types/aiSdk';

interface AiSdkToolPair {
  call: AiSdkToolCallPart;
  result: AiSdkToolResultPart;
}

function aiSdkToolCallId(message: Message<unknown>) {
  return metadataString(message, 'aiSdk', ['toolCallId', 'tool_call_id'], [
    'aiSdkToolCallId',
    'ai_sdk_tool_call_id',
    'toolCallId',
    'tool_call_id',
    'providerToolCallId',
  ]);
}

function resolveAiSdkToolCallId<TMeta>(message: ToolMessage<TMeta>): string {
  const metadataId = aiSdkToolCallId(message as Message<unknown>);
  if (metadataId) return metadataId;

  const toolCallId = nonEmptyString(message.toolCall?.id);
  if (toolCallId) return toolCallId;

  const synthesized = `chorus_synth_${message.id}`;
  warnOnceInDev(
    `react-chorus:ai-sdk-tool-call-id:${message.id}`,
    `[react-chorus] AI SDK tool message "${message.id}" has no tool-call id in metadata; `
      + `synthesized a best-effort id ("${synthesized}") so the tool call is preserved. `
      + 'Set metadata.aiSdk.toolCallId (or toolCall.id) to the provider id.',
  );
  return synthesized;
}

function aiSdkToolResultIsError(message: Message<unknown>) {
  return metadataBoolean(message, 'aiSdk', ['isError', 'is_error'], ['isError', 'is_error']);
}

function httpUrlFromAttachment(attachment: Attachment): URL | null {
  for (const candidate of [attachment.url, attachment.data]) {
    if (typeof candidate !== 'string' || !candidate || candidate.startsWith('data:')) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url;
    } catch {
      // Relative URLs and provider file ids are not generic AI SDK data content;
      // let them fall through to the explicit unsupported-attachment text block.
    }
  }
  return null;
}

function aiSdkAttachmentPartFromSource(
  source: AiSdkDataContent,
  mimeType: string,
  attachment: Attachment,
): AiSdkImagePart | AiSdkFilePart {
  if (mimeType.startsWith('image/')) return { type: 'image', image: source, mediaType: mimeType };

  const part: AiSdkFilePart = {
    type: 'file',
    data: source,
    mediaType: mimeType || 'application/octet-stream',
  };
  if (attachment.name) part.filename = attachment.name;
  return part;
}

function aiSdkAttachmentPart(attachment: Attachment): AiSdkUserContentPart | null {
  const url = httpUrlFromAttachment(attachment);
  if (url) {
    return aiSdkAttachmentPartFromSource(url, attachment.type || 'application/octet-stream', attachment);
  }

  const dataUrl = dataUrlFromAttachment(attachment);
  if (!dataUrl) return null;

  return aiSdkAttachmentPartFromSource(
    dataUrl.base64,
    resolveDataUrlMimeType(attachment, dataUrl),
    attachment,
  );
}

function aiSdkUserContent<TMeta>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
): string | AiSdkUserContentPart[] | null {
  const parts = messageContentParts<TMeta, AiSdkUserContentPart>(message, options, {
    provider: 'AI SDK',
    createTextPart: text => ({ type: 'text', text }),
    mapAttachment: aiSdkAttachmentPart,
  });

  if (!parts.length) return null;
  const single = parts[0];
  return parts.length === 1 && single && single.type === 'text' ? single.text : parts;
}

function aiSdkAssistantContent<TMeta>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
): string | AiSdkAssistantContentPart[] | null {
  const parts: AiSdkAssistantContentPart[] = [];
  const reasoning = message.reasoning?.trim();
  if (reasoning) parts.push({ type: 'reasoning', text: reasoning });

  parts.push(...messageContentParts<TMeta, AiSdkTextPart>(message, options, {
    provider: 'AI SDK',
    createTextPart: text => ({ type: 'text', text }),
  }));

  if (!parts.length) return null;
  const single = parts[0];
  return parts.length === 1 && single && single.type === 'text' ? single.text : parts;
}

function aiSdkAssistantParts(content: string | AiSdkAssistantContentPart[]): AiSdkAssistantContentPart[] {
  if (Array.isArray(content)) return content;
  const text = content.trim();
  return text ? [{ type: 'text', text }] : [];
}

function aiSdkToolCallPartId(part: AiSdkAssistantContentPart) {
  return part.type === 'tool-call' ? part.toolCallId : null;
}

function appendAiSdkToolCalls(target: AiSdkModelMessage[], toolCalls: AiSdkToolCallPart[]) {
  const last = target[target.length - 1];
  const existingParts = last?.role === 'assistant' ? aiSdkAssistantParts(last.content) : [];
  const seenIds = new Set<string>();

  for (const part of existingParts) {
    const id = aiSdkToolCallPartId(part);
    if (id) seenIds.add(id);
  }

  const dedupedToolCalls: AiSdkToolCallPart[] = [];
  for (const toolCall of toolCalls) {
    if (seenIds.has(toolCall.toolCallId)) continue;
    seenIds.add(toolCall.toolCallId);
    dedupedToolCalls.push(toolCall);
  }

  if (!dedupedToolCalls.length) return;

  if (last?.role === 'assistant') {
    last.content = existingParts.concat(dedupedToolCalls);
    return;
  }

  target.push({ role: 'assistant', content: dedupedToolCalls });
}

function toAiSdkJsonValue(value: unknown): AiSdkJsonValue {
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return JSON.parse(json) as AiSdkJsonValue;
  } catch {
    // Fall through to a string representation so unsupported values are still visible.
  }
  return safeStringify(value);
}

function aiSdkToolResultOutput<TMeta>(message: ToolMessage<TMeta>): AiSdkToolResultOutput {
  const value = toolOutputValue(message);
  const isError = aiSdkToolResultIsError(message as Message<unknown>);

  if (typeof value === 'string' || value === undefined) {
    return { type: isError ? 'error-text' : 'text', value: value ?? '' };
  }

  return {
    type: isError ? 'error-json' : 'json',
    value: toAiSdkJsonValue(value),
  };
}

function aiSdkToolPair<TMeta>(message: ToolMessage<TMeta>): AiSdkToolPair | null {
  if (!message.toolCall) return null;

  const toolCallId = resolveAiSdkToolCallId(message);
  const toolName = message.toolCall.name || 'tool';
  const input = hasOwn(message.toolCall, 'input') ? message.toolCall.input : {};

  return {
    call: { type: 'tool-call', toolCallId, toolName, input },
    result: { type: 'tool-result', toolCallId, toolName, output: aiSdkToolResultOutput(message) },
  };
}

function toAiSdkModelMessage<TMeta>(
  message: Message<TMeta>,
  options: ProviderMappingOptions<TMeta>,
): AiSdkModelMessage | null {
  if (message.role === 'system') {
    const trimmed = message.text.trim();
    return trimmed ? { role: 'system', content: trimmed } : null;
  }

  if (message.role === 'assistant') {
    const content = aiSdkAssistantContent(message, options);
    return content !== null ? { role: 'assistant', content } : null;
  }

  if (message.role === 'user') {
    const content = aiSdkUserContent(message, options);
    return content !== null ? { role: 'user', content } : null;
  }

  if (message.role === 'tool') {
    const text = toolContextText(message);
    return text ? { role: 'user', content: text } : null;
  }

  return null;
}

/** Convert Chorus messages into Vercel AI SDK `ModelMessage[]` for `streamText({ messages })`. */
export function toAiSdkModelMessages<TMeta = Record<string, unknown>>(
  history: Message<TMeta>[],
  options: ProviderMappingOptions<TMeta> = {},
): AiSdkModelMessage[] {
  return mapHistoryWithToolRuns<TMeta, AiSdkToolPair, AiSdkModelMessage>(history, {
    groupMode: 'all',
    mapMessage: message => toAiSdkModelMessage(message, options),
    extractToolBlock: message => aiSdkToolPair(message),
    emitToolGroup: (target, pairs) => {
      appendAiSdkToolCalls(target, pairs.map(entry => entry.block.call));
      target.push({ role: 'tool', content: pairs.map(entry => entry.block.result) });
    },
    fallback: message => toAiSdkModelMessage(message, options),
  });
}

function stripAiSdkOptions<TMeta>(options: AiSdkModelMessagesBodyOptions<TMeta>) {
  const { unsupportedAttachmentText: _unsupportedAttachmentText, ...bodyOptions } = options;
  void _unsupportedAttachmentText;
  return bodyOptions;
}

/** Build a JSON-serializable body containing AI SDK `messages`. */
export function toAiSdkModelMessagesBody<
  TMeta = Record<string, unknown>,
  TOptions extends AiSdkModelMessagesBodyOptions<TMeta> = AiSdkModelMessagesBodyOptions<TMeta>,
>(history: Message<TMeta>[], options?: TOptions): AiSdkModelMessagesBody<TOptions> {
  const opts = (options ?? {}) as TOptions;
  const body = {
    ...stripAiSdkOptions(opts),
    messages: toAiSdkModelMessages(history, opts),
  };
  return body as AiSdkModelMessagesBody<TOptions>;
}

/** JSON body formatter for `createFetchSSETransport(..., { formatBody })`. */
export function formatAiSdkModelMessagesBody<TMeta = Record<string, unknown>>(
  options: AiSdkModelMessagesBodyOptions<TMeta> = {},
) {
  return (_text: string, history: Message<TMeta>[]): string => JSON.stringify(toAiSdkModelMessagesBody(history, options));
}
