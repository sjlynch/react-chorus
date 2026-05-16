import type {
  AnthropicMessagesBodyOptions,
  GeminiGenerateContentBodyOptions,
  OpenAIChatCompletionsBodyOptions,
  OpenAIResponsesBodyOptions,
} from './types';

export function stripOpenAIChatOptions<TMeta>(options: OpenAIChatCompletionsBodyOptions<TMeta>) {
  const { unsupportedAttachmentText: _unsupportedAttachmentText, stream = true, ...bodyOptions } = options;
  void _unsupportedAttachmentText;
  return { bodyOptions, stream };
}

export function stripOpenAIResponsesOptions<TMeta>(options: OpenAIResponsesBodyOptions<TMeta>) {
  const { unsupportedAttachmentText: _unsupportedAttachmentText, stream = true, ...bodyOptions } = options;
  void _unsupportedAttachmentText;
  return { bodyOptions, stream };
}

export function stripAnthropicOptions<TMeta>(options: AnthropicMessagesBodyOptions<TMeta>) {
  const { unsupportedAttachmentText: _unsupportedAttachmentText, stream = true, ...bodyOptions } = options;
  void _unsupportedAttachmentText;
  return { bodyOptions, stream };
}

export function stripGeminiOptions<TMeta>(options: GeminiGenerateContentBodyOptions<TMeta>) {
  const { unsupportedAttachmentText: _unsupportedAttachmentText, ...bodyOptions } = options;
  void _unsupportedAttachmentText;
  return bodyOptions;
}
