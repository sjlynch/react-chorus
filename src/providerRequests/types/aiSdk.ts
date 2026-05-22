import type { ProviderMappingOptions, StripUnsupportedAttachmentOption } from './common';

export interface AiSdkModelMessagesBodyOptions<TMeta = Record<string, unknown>> extends ProviderMappingOptions<TMeta> {
  [key: string]: unknown;
}

export type AiSdkDataContent = string | URL;

export type AiSdkJsonValue =
  | null
  | boolean
  | number
  | string
  | AiSdkJsonValue[]
  | { [key: string]: AiSdkJsonValue };

export interface AiSdkTextPart {
  type: 'text';
  text: string;
}

export interface AiSdkReasoningPart {
  type: 'reasoning';
  text: string;
}

export interface AiSdkImagePart {
  type: 'image';
  image: AiSdkDataContent;
  mediaType?: string;
}

export interface AiSdkFilePart {
  type: 'file';
  data: AiSdkDataContent;
  mediaType: string;
  filename?: string;
}

export interface AiSdkToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export type AiSdkToolResultOutput =
  | { type: 'text'; value: string }
  | { type: 'json'; value: AiSdkJsonValue }
  | { type: 'error-text'; value: string }
  | { type: 'error-json'; value: AiSdkJsonValue };

export interface AiSdkToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: AiSdkToolResultOutput;
}

export type AiSdkUserContentPart = AiSdkTextPart | AiSdkImagePart | AiSdkFilePart;
export type AiSdkAssistantContentPart = AiSdkTextPart | AiSdkReasoningPart | AiSdkToolCallPart;

export interface AiSdkSystemModelMessage {
  role: 'system';
  content: string;
}

export interface AiSdkUserModelMessage {
  role: 'user';
  content: string | AiSdkUserContentPart[];
}

export interface AiSdkAssistantModelMessage {
  role: 'assistant';
  content: string | AiSdkAssistantContentPart[];
}

export interface AiSdkToolModelMessage {
  role: 'tool';
  content: AiSdkToolResultPart[];
}

export type AiSdkModelMessage =
  | AiSdkSystemModelMessage
  | AiSdkUserModelMessage
  | AiSdkAssistantModelMessage
  | AiSdkToolModelMessage;

export type AiSdkModelMessagesBody<TOptions = object> = StripUnsupportedAttachmentOption<TOptions> & {
  messages: AiSdkModelMessage[];
};
