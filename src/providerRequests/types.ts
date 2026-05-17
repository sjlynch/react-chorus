import type { Attachment, Message } from '../types';
import type { ChorusToolDefinition, ChorusToolRegistry } from '../tools';

export type UnsupportedAttachmentText<TMeta = Record<string, unknown>> = (
  attachment: Attachment,
  message: Message<TMeta>,
) => string;

export interface ProviderMappingOptions<TMeta = Record<string, unknown>> {
  /** Override the text block inserted when an attachment cannot be represented in the provider schema. */
  unsupportedAttachmentText?: UnsupportedAttachmentText<TMeta>;
}

/** Convenience type for the `tools` body option: array of definitions or full Chorus tool registry. */
export type ProviderToolsOption<TMeta = Record<string, unknown>> =
  | ChorusToolDefinition<TMeta>[]
  | ChorusToolRegistry<TMeta>;

export interface OpenAIChatCompletionsBodyOptions<TMeta = Record<string, unknown>> extends ProviderMappingOptions<TMeta> {
  model?: string;
  stream?: boolean;
  /** Chorus tool definitions; serialized into OpenAI Chat Completions `tools`. Falls through unchanged if a raw OpenAI tool array is detected. */
  tools?: ProviderToolsOption<TMeta>;
  [key: string]: unknown;
}

export interface OpenAIResponsesBodyOptions<TMeta = Record<string, unknown>> extends ProviderMappingOptions<TMeta> {
  model?: string;
  stream?: boolean;
  /** Chorus tool definitions; serialized into OpenAI Responses `tools`. Falls through unchanged if a raw OpenAI tool array is detected. */
  tools?: ProviderToolsOption<TMeta>;
  [key: string]: unknown;
}

export interface AnthropicMessagesBodyOptions<TMeta = Record<string, unknown>> extends ProviderMappingOptions<TMeta> {
  model?: string;
  max_tokens?: number;
  stream?: boolean;
  /** Chorus tool definitions; serialized into Anthropic Messages `tools`. Falls through unchanged if a raw Anthropic tool array is detected. */
  tools?: ProviderToolsOption<TMeta>;
  [key: string]: unknown;
}

export interface GeminiGenerateContentBodyOptions<TMeta = Record<string, unknown>> extends ProviderMappingOptions<TMeta> {
  /** Chorus tool definitions; serialized into Gemini `tools` (wrapped in `functionDeclarations`). Falls through unchanged if a raw Gemini tool array is detected. */
  tools?: ProviderToolsOption<TMeta>;
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
