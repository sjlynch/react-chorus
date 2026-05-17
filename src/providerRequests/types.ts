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

// ───── OpenAI Chat Completions message shapes ─────

export interface OpenAIChatCompletionsTextPart {
  type: 'text';
  text: string;
}

export interface OpenAIChatCompletionsImagePart {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export type OpenAIChatCompletionsUserContentPart =
  | OpenAIChatCompletionsTextPart
  | OpenAIChatCompletionsImagePart;

export interface OpenAIChatCompletionsToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAIChatCompletionsSystemMessage {
  role: 'system';
  content: string;
}

export interface OpenAIChatCompletionsUserMessage {
  role: 'user';
  content: string | OpenAIChatCompletionsUserContentPart[];
}

export interface OpenAIChatCompletionsAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: OpenAIChatCompletionsToolCall[];
}

export interface OpenAIChatCompletionsToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

export type OpenAIChatCompletionsMessage =
  | OpenAIChatCompletionsSystemMessage
  | OpenAIChatCompletionsUserMessage
  | OpenAIChatCompletionsAssistantMessage
  | OpenAIChatCompletionsToolMessage;

// ───── OpenAI Responses API input items ─────

export interface OpenAIResponsesInputTextPart {
  type: 'input_text';
  text: string;
}

export interface OpenAIResponsesOutputTextPart {
  type: 'output_text';
  text: string;
}

export interface OpenAIResponsesInputImagePart {
  type: 'input_image';
  image_url: string;
}

export interface OpenAIResponsesInputFilePart {
  type: 'input_file';
  file_id?: string;
  file_url?: string;
}

export type OpenAIResponsesInputContentPart =
  | OpenAIResponsesInputTextPart
  | OpenAIResponsesInputImagePart
  | OpenAIResponsesInputFilePart;

export interface OpenAIResponsesSystemInputItem {
  role: 'system';
  content: OpenAIResponsesInputContentPart[];
}

export interface OpenAIResponsesUserInputItem {
  role: 'user';
  content: OpenAIResponsesInputContentPart[];
}

export interface OpenAIResponsesAssistantInputItem {
  role: 'assistant';
  content: OpenAIResponsesOutputTextPart[];
}

export interface OpenAIResponsesFunctionCallInputItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

export interface OpenAIResponsesFunctionCallOutputInputItem {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

export type OpenAIResponsesInputItem =
  | OpenAIResponsesSystemInputItem
  | OpenAIResponsesUserInputItem
  | OpenAIResponsesAssistantInputItem
  | OpenAIResponsesFunctionCallInputItem
  | OpenAIResponsesFunctionCallOutputInputItem;

// ───── Anthropic Messages API block shapes ─────

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

export interface AnthropicDocumentBlock {
  type: 'document';
  source: { type: 'base64'; media_type: string; data: string };
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicDocumentBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

// ───── Gemini Content / Parts ─────

export interface GeminiTextPart {
  text: string;
}

export interface GeminiInlineDataPart {
  inlineData: { mimeType: string; data: string };
}

export interface GeminiFileDataPart {
  fileData: { mimeType: string; fileUri: string };
}

export interface GeminiFunctionCallPart {
  functionCall: { name: string; args: Record<string, unknown> };
}

export interface GeminiFunctionResponsePart {
  functionResponse: { name: string; response: Record<string, unknown> };
}

export type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiFileDataPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart;

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

// ───── Body shapes ─────
//
// Body return types use a generic so that fields the caller passes in options
// (e.g. `model`, `temperature`, `tools`) survive into the returned object's
// type. This lets the helper output be assigned to or `satisfies`-checked
// against the official SDK request types without `as unknown as` bridges.

type StripChorusOptions<T> = Omit<T, 'unsupportedAttachmentText' | 'stream'>;

export type OpenAIChatCompletionsBody<TOptions = object> = StripChorusOptions<TOptions> & {
  messages: OpenAIChatCompletionsMessage[];
  stream: boolean;
};

export type OpenAIResponsesBody<TOptions = object> = StripChorusOptions<TOptions> & {
  input: OpenAIResponsesInputItem[];
  stream: boolean;
};

export type AnthropicMessagesBody<TOptions = object> = StripChorusOptions<TOptions> & {
  messages: AnthropicMessage[];
  stream: boolean;
  system?: string;
};

export type GeminiGenerateContentBody<TOptions = object> = Omit<TOptions, 'unsupportedAttachmentText'> & {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
};
