import type { Message, ToolMessage } from '../types';
import { resolveProviderAttachmentSource, unsupportedAttachmentPart } from './attachments';
import { isRecord } from './metadata';
import { resolveProviderSystem, stripGeminiOptions, systemTextFromHistory } from './options';
import { messageText, objectToolInput, safeStringify, toolContextText, toolOutputValue } from './toolOutput';
import { mapHistoryWithToolRuns } from './toolRunMapper';
import type { ProviderMappingOptions } from './types/common';
import type {
  GeminiContent,
  GeminiFunctionCallPart,
  GeminiFunctionResponsePart,
  GeminiGenerateContentBody,
  GeminiGenerateContentBodyOptions,
  GeminiPart,
} from './types/gemini';

// Gemini accepts base64 `inlineData` only for this documented image / audio /
// video / PDF MIME set. Any other data-URL attachment must be routed through
// `unsupportedAttachmentText` instead of an `inlineData` part the API rejects.
const GEMINI_INLINE_DATA_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
  'audio/wav',
  'audio/mp3',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'video/mp4',
  'video/mpeg',
  'video/mov',
  'video/avi',
  'video/x-flv',
  'video/mpg',
  'video/webm',
  'video/wmv',
  'video/3gpp',
  'application/pdf',
]);

function geminiSystemInstruction(history: Message<unknown>[]) {
  const system = systemTextFromHistory(history);
  return system ? { parts: [{ text: system }] } : undefined;
}

function geminiParts<TMeta>(message: Message<TMeta>, options: ProviderMappingOptions<TMeta>): GeminiPart[] {
  const parts: GeminiPart[] = [];
  const text = messageText(message);
  if (text.trim()) parts.push({ text });

  if (message.role === 'user') {
    for (const attachment of message.attachments ?? []) {
      const source = resolveProviderAttachmentSource(attachment, GEMINI_INLINE_DATA_MIME_TYPES, { allowFileUri: true });
      if (source.kind === 'data-url') {
        parts.push({ inlineData: { mimeType: source.mimeType, data: source.base64 } });
      } else if (source.kind === 'file-uri') {
        parts.push({ fileData: { mimeType: source.mimeType, fileUri: source.fileUri } });
      } else {
        parts.push(unsupportedAttachmentPart(attachment, message, options, text => ({ text })));
      }
    }
  }

  return parts;
}

function geminiFunctionResponsePayload(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === 'string') return { content: value };
  return { content: safeStringify(value) };
}

function geminiFunctionCallPart<TMeta>(message: ToolMessage<TMeta>, name: string): GeminiFunctionCallPart {
  return { functionCall: { name, args: objectToolInput(message.toolCall.input) } };
}

function geminiFunctionResponsePart<TMeta>(message: ToolMessage<TMeta>, name: string): GeminiFunctionResponsePart {
  // Reuse the shared `toolOutputValue` helper (which keys off `hasOwn`, not
  // `??`) so an explicit `output: null` is honored instead of falling through
  // to message text — the same value resolution OpenAI and Anthropic use.
  return { functionResponse: { name, response: geminiFunctionResponsePayload(toolOutputValue(message)) } };
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
  return mapHistoryWithToolRuns<TMeta, string, GeminiContent>(history, {
    groupMode: 'contiguous',
    mapMessage: message => toGeminiContent(message, options),
    // `toolCall` is required on `ToolMessage` at the type level, but the
    // request mappers tolerate loose runtime history (raw JSON, hand-built
    // entries, connector bugs). Guard it like the other three mappers so a
    // `{ role: 'tool' }` entry missing `toolCall` delegates to the guarded
    // text fallback instead of throwing deep inside `toGeminiContents`.
    extractToolBlock: message => message.toolCall?.name || null,
    emitToolGroup: (target, pairs) => {
      appendGeminiFunctionCalls(target, pairs.map(entry => geminiFunctionCallPart(entry.message, entry.block)));
      target.push({ role: 'user', parts: pairs.map(entry => geminiFunctionResponsePart(entry.message, entry.block)) });
    },
    fallback: message => toGeminiContent(message, options),
  });
}

/** Build a Gemini generateContent request body. Use it with a streaming Gemini endpoint and `connector="gemini"`. */
export function toGeminiGenerateContentBody<
  TMeta = Record<string, unknown>,
  TOptions extends GeminiGenerateContentBodyOptions<TMeta> = GeminiGenerateContentBodyOptions<TMeta>,
>(history: Message<TMeta>[], options?: TOptions): GeminiGenerateContentBody<TOptions> {
  const opts = (options ?? {}) as TOptions;
  const { bodyOptions, systemInstruction: callerSystemInstruction } = stripGeminiOptions(opts);
  // A caller-supplied `systemInstruction` wins over history-derived system
  // text (documented precedence); a dev warn-once fires when both are present.
  const systemInstruction = resolveProviderSystem(
    'Gemini',
    'systemInstruction',
    callerSystemInstruction,
    geminiSystemInstruction(history as Message<unknown>[]),
  );
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
