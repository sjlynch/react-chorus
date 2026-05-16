// Type-only tests that verify the provider request helpers' output can be
// fed to representative official-SDK function signatures without `as unknown`
// bridges. The "SDK" types below are hand-rolled approximations of the public
// shapes from `openai`, `@anthropic-ai/sdk`, and `@google/generative-ai`; they
// are intentionally kept narrow so that the test fails if our helpers drift
// looser than the real SDKs accept.

import {
  toAnthropicMessages,
  toAnthropicMessagesBody,
  toGeminiContents,
  toGeminiGenerateContentBody,
  toOpenAIChatCompletionsBody,
  toOpenAIChatCompletionsMessages,
  toOpenAIResponsesBody,
  toOpenAIResponsesInput,
} from '../providerRequests';
import type { Message } from '../index';

const history: Message[] = [
  { id: 'sys', role: 'system', text: 'Be concise.' },
  { id: 'u1', role: 'user', text: 'Hi', attachments: [] },
  { id: 'a1', role: 'assistant', text: 'Hello!' },
];

// ───── OpenAI Chat Completions SDK shape ─────

type SdkOpenAITextPart = { type: 'text'; text: string };
type SdkOpenAIImagePart = {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
};
type SdkOpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};
type SdkOpenAIChatMessage =
  | { role: 'system'; content: string | SdkOpenAITextPart[] }
  | { role: 'user'; content: string | Array<SdkOpenAITextPart | SdkOpenAIImagePart> }
  | { role: 'assistant'; content?: string | null; tool_calls?: SdkOpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string | SdkOpenAITextPart[] };

interface SdkChatCompletionCreateParams {
  messages: SdkOpenAIChatMessage[];
  model: string;
  temperature?: number;
  stream?: boolean | null;
}

interface SdkChatCompletionCreateParamsStreaming extends SdkChatCompletionCreateParams {
  stream: true;
}

declare function sdkCreateChatCompletion(params: SdkChatCompletionCreateParams): Promise<unknown>;
declare function sdkCreateChatCompletionStream(params: SdkChatCompletionCreateParamsStreaming): Promise<unknown>;

const chatMessages = toOpenAIChatCompletionsMessages(history);
const _chatMessagesIsAssignable: SdkOpenAIChatMessage[] = chatMessages;
void _chatMessagesIsAssignable;

// Direct: pass model + stream via helper options, spread, no cast.
const chatBody = {
  ...toOpenAIChatCompletionsBody(history, { model: 'gpt-4o-mini' }),
  stream: true,
} satisfies SdkChatCompletionCreateParamsStreaming;
void sdkCreateChatCompletionStream(chatBody);

// `satisfies` with non-streaming variant and extra options preserved.
const chatBodyWithExtras = toOpenAIChatCompletionsBody(history, {
  model: 'gpt-4o-mini',
  temperature: 0.7,
  stream: false,
}) satisfies SdkChatCompletionCreateParams;
void sdkCreateChatCompletion(chatBodyWithExtras);

// ───── OpenAI Responses SDK shape ─────

type SdkResponsesInputTextPart = { type: 'input_text'; text: string };
type SdkResponsesOutputTextPart = { type: 'output_text'; text: string };
type SdkResponsesInputImagePart = { type: 'input_image'; image_url: string };
type SdkResponsesInputItem =
  | { role: 'system'; content: Array<SdkResponsesInputTextPart | SdkResponsesInputImagePart> }
  | { role: 'user'; content: Array<SdkResponsesInputTextPart | SdkResponsesInputImagePart> }
  | { role: 'assistant'; content: SdkResponsesOutputTextPart[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

interface SdkResponseCreateParams {
  model: string;
  input: SdkResponsesInputItem[];
  stream?: boolean | null;
}

interface SdkResponseCreateParamsStreaming extends SdkResponseCreateParams {
  stream: true;
}

declare function sdkCreateResponse(params: SdkResponseCreateParams): Promise<unknown>;
declare function sdkCreateResponseStream(params: SdkResponseCreateParamsStreaming): Promise<unknown>;

const responsesInput = toOpenAIResponsesInput(history);
const _responsesInputAssignable: SdkResponsesInputItem[] = responsesInput;
void _responsesInputAssignable;

const responsesBody = {
  ...toOpenAIResponsesBody(history, { model: 'gpt-4o-mini' }),
  stream: true,
} satisfies SdkResponseCreateParamsStreaming;
void sdkCreateResponseStream(responsesBody);

const responsesNonStreaming = toOpenAIResponsesBody(history, {
  model: 'gpt-4o-mini',
  stream: false,
}) satisfies SdkResponseCreateParams;
void sdkCreateResponse(responsesNonStreaming);

// ───── Anthropic Messages SDK shape ─────

type SdkAnthropicTextBlock = { type: 'text'; text: string };
type SdkAnthropicImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
};
type SdkAnthropicToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type SdkAnthropicToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string | SdkAnthropicTextBlock[];
};
type SdkAnthropicContentBlock =
  | SdkAnthropicTextBlock
  | SdkAnthropicImageBlock
  | SdkAnthropicToolUseBlock
  | SdkAnthropicToolResultBlock;

interface SdkAnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string | SdkAnthropicContentBlock[];
}

interface SdkAnthropicMessageCreateParams {
  model: string;
  max_tokens: number;
  messages: SdkAnthropicMessageParam[];
  system?: string;
  stream?: boolean;
}

declare function sdkAnthropicCreateMessage(params: SdkAnthropicMessageCreateParams): Promise<unknown>;

const anthropicMessages = toAnthropicMessages(history);
const _anthropicMessagesAssignable: SdkAnthropicMessageParam[] = anthropicMessages;
void _anthropicMessagesAssignable;

const anthropicBody = toAnthropicMessagesBody(history, {
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
}) satisfies SdkAnthropicMessageCreateParams;
void sdkAnthropicCreateMessage(anthropicBody);

// ───── Gemini GenerateContent SDK shape ─────

type SdkGeminiTextPart = { text: string };
type SdkGeminiInlineDataPart = { inlineData: { mimeType: string; data: string } };
type SdkGeminiFileDataPart = { fileData: { mimeType: string; fileUri: string } };
type SdkGeminiFunctionCallPart = { functionCall: { name: string; args: Record<string, unknown> } };
type SdkGeminiFunctionResponsePart = {
  functionResponse: { name: string; response: Record<string, unknown> };
};
type SdkGeminiPart =
  | SdkGeminiTextPart
  | SdkGeminiInlineDataPart
  | SdkGeminiFileDataPart
  | SdkGeminiFunctionCallPart
  | SdkGeminiFunctionResponsePart;

interface SdkGeminiContent {
  role: 'user' | 'model';
  parts: SdkGeminiPart[];
}

interface SdkGeminiGenerateContentRequest {
  contents: SdkGeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
}

declare function sdkGeminiGenerateContent(request: SdkGeminiGenerateContentRequest): Promise<unknown>;

const geminiContents = toGeminiContents(history);
const _geminiContentsAssignable: SdkGeminiContent[] = geminiContents;
void _geminiContentsAssignable;

const geminiBody = toGeminiGenerateContentBody(history) satisfies SdkGeminiGenerateContentRequest;
void sdkGeminiGenerateContent(geminiBody);

// ───── Variants: typed metadata + custom unsupported attachment text ─────

interface TraceMeta {
  traceId: string;
}

const typedHistory: Message<TraceMeta>[] = [
  { id: 'u', role: 'user', text: 'Hi', attachments: [], metadata: { traceId: 't1' } },
];

const typedChatBody = {
  ...toOpenAIChatCompletionsBody(typedHistory, {
    model: 'gpt-4o-mini',
    unsupportedAttachmentText: (_attachment, message) => `[${message.metadata?.traceId ?? 'no-trace'}]`,
  }),
  stream: true,
} satisfies SdkChatCompletionCreateParamsStreaming;
void typedChatBody;
