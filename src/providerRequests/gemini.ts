import type { Message, ToolMessage } from '../types';
import { dataUrlFromAttachment, fileUriFromAttachment, unsupportedAttachmentText } from './attachments';
import { isRecord } from './metadata';
import { stripGeminiOptions } from './options';
import { messageText, objectToolInput, safeStringify, toolContextText } from './toolOutput';
import type {
  GeminiContent,
  GeminiFunctionCallPart,
  GeminiFunctionResponsePart,
  GeminiGenerateContentBody,
  GeminiGenerateContentBodyOptions,
  GeminiPart,
  ProviderMappingOptions,
} from './types';

type GeminiToolMessage<TMeta> = { message: ToolMessage<TMeta>; name: string };

function geminiSystemInstruction(history: Message<unknown>[]) {
  const system = history
    .filter(message => message.role === 'system' && message.text.trim())
    .map(message => message.text)
    .join('\n\n');
  return system ? { parts: [{ text: system }] } : undefined;
}

function geminiParts<TMeta>(message: Message<TMeta>, options: ProviderMappingOptions<TMeta>): GeminiPart[] {
  const parts: GeminiPart[] = [];
  const text = messageText(message);
  if (text.trim()) parts.push({ text });

  if (message.role === 'user') {
    for (const attachment of message.attachments ?? []) {
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

      parts.push({ text: unsupportedAttachmentText(attachment, message, options) });
    }
  }

  return parts;
}

function geminiFunctionResponsePayload(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === 'string') return { content: value };
  return { content: safeStringify(value) };
}

function geminiToolMessage<TMeta>(message: Message<TMeta>): GeminiToolMessage<TMeta> | null {
  if (message.role !== 'tool') return null;
  const name = message.toolCall.name;
  return name ? { message, name } : null;
}

function geminiFunctionCallPart<TMeta>({ message, name }: GeminiToolMessage<TMeta>): GeminiFunctionCallPart {
  return { functionCall: { name, args: objectToolInput(message.toolCall.input) } };
}

function geminiFunctionResponsePart<TMeta>({ message, name }: GeminiToolMessage<TMeta>): GeminiFunctionResponsePart {
  const text = messageText(message);
  const value = message.toolCall.output ?? (text.trim() ? text : message.toolCall.input);
  return { functionResponse: { name, response: geminiFunctionResponsePayload(value) } };
}

function appendGeminiFunctionCalls(target: GeminiContent[], parts: GeminiPart[]) {
  if (!parts.length) return;

  const last = target[target.length - 1];
  if (last?.role === 'model' && Array.isArray(last.parts)) {
    last.parts = last.parts.concat(parts);
    return;
  }

  target.push({ role: 'model', parts });
}

function appendGeminiToolRun<TMeta>(target: GeminiContent[], run: Array<GeminiToolMessage<TMeta>>) {
  if (!run.length) return;

  appendGeminiFunctionCalls(target, run.map(geminiFunctionCallPart));
  target.push({ role: 'user', parts: run.map(geminiFunctionResponsePart) });
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
    const text = toolContextText(message);
    return text ? { role: 'user', parts: [{ text }] } : null;
  }

  return null;
}

/** Convert Chorus messages into Gemini `contents`. System messages are returned by `toGeminiGenerateContentBody().systemInstruction`. */
export function toGeminiContents<TMeta = Record<string, unknown>>(
  history: Message<TMeta>[],
  options: ProviderMappingOptions<TMeta> = {},
): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (let i = 0; i < history.length; i += 1) {
    const message = history[i];
    if (!message) continue;
    if (message.role !== 'tool') {
      const mapped = toGeminiContent(message, options);
      if (mapped) contents.push(mapped);
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

    let run: Array<GeminiToolMessage<TMeta>> = [];
    for (const toolMessage of group) {
      const geminiTool = geminiToolMessage(toolMessage);
      if (geminiTool) {
        run.push(geminiTool);
        continue;
      }

      appendGeminiToolRun(contents, run);
      run = [];

      const mapped = toGeminiContent(toolMessage, options);
      if (mapped) contents.push(mapped);
    }

    appendGeminiToolRun(contents, run);
  }

  return contents;
}

/** Build a Gemini generateContent request body. Use it with a streaming Gemini endpoint and `connector="gemini"`. */
export function toGeminiGenerateContentBody<
  TMeta = Record<string, unknown>,
  TOptions extends GeminiGenerateContentBodyOptions<TMeta> = GeminiGenerateContentBodyOptions<TMeta>,
>(history: Message<TMeta>[], options?: TOptions): GeminiGenerateContentBody<TOptions> {
  const opts = (options ?? {}) as TOptions;
  const bodyOptions = stripGeminiOptions(opts);
  const systemInstruction = geminiSystemInstruction(history as Message<unknown>[]);
  const body = {
    ...bodyOptions,
    ...(systemInstruction ? { systemInstruction } : {}),
    contents: toGeminiContents(history, opts),
  };
  return body as GeminiGenerateContentBody<TOptions>;
}

/** JSON body formatter for `createFetchSSETransport(..., { formatBody })`. */
export function formatGeminiGenerateContentBody<TMeta = Record<string, unknown>>(
  options: GeminiGenerateContentBodyOptions<TMeta> = {},
) {
  return (_text: string, history: Message<TMeta>[]): string => JSON.stringify(toGeminiGenerateContentBody(history, options));
}
