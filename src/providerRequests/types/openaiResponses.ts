import type { ProviderMappingOptions, ProviderToolsOption, StripChorusOptions } from './common';

export interface OpenAIResponsesBodyOptions<TMeta = Record<string, unknown>> extends ProviderMappingOptions<TMeta> {
  model?: string;
  stream?: boolean;
  /** Chorus tool definitions; serialized into OpenAI Responses `tools`. Falls through unchanged if a raw OpenAI tool array is detected. */
  tools?: ProviderToolsOption<TMeta>;
  [key: string]: unknown;
}

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

export type OpenAIResponsesBody<TOptions = object> = StripChorusOptions<TOptions> & {
  input: OpenAIResponsesInputItem[];
  stream: boolean;
};
