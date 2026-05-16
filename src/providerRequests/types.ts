import type { Attachment, Message } from '../types';

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
