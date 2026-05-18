import type { ProviderMappingOptions, ProviderToolsOption, StripChorusOptions } from './common';

export interface OpenAIChatCompletionsBodyOptions<TMeta = Record<string, unknown>> extends ProviderMappingOptions<TMeta> {
  model?: string;
  stream?: boolean;
  /** Chorus tool definitions; serialized into OpenAI Chat Completions `tools`. Falls through unchanged if a raw OpenAI tool array is detected. */
  tools?: ProviderToolsOption<TMeta>;
  [key: string]: unknown;
}

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

export type OpenAIChatCompletionsBody<TOptions = object> = StripChorusOptions<TOptions> & {
  messages: OpenAIChatCompletionsMessage[];
  stream: boolean;
};
