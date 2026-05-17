import { toToolDefinitionList } from '../tools';
import type { ProviderToolsOption } from './types';
import type {
  AnthropicMessagesBodyOptions,
  GeminiGenerateContentBodyOptions,
  OpenAIChatCompletionsBodyOptions,
  OpenAIResponsesBodyOptions,
} from './types';
import {
  toAnthropicTools,
  toGeminiTools,
  toOpenAIChatCompletionsTools,
  toOpenAIResponsesTools,
} from './tools';

/**
 * Tools is Chorus-shaped when it's an array containing a `handler` function or
 * a record whose values are functions / objects with `handler`. Plain provider
 * tool arrays (OpenAI/Anthropic/Gemini shapes) fall through as the escape
 * hatch.
 */
function isChorusToolsSource(tools: unknown): tools is ProviderToolsOption<unknown> {
  if (Array.isArray(tools)) {
    return tools.some(item => item && typeof item === 'object' && typeof (item as { handler?: unknown }).handler === 'function');
  }
  if (tools && typeof tools === 'object') {
    for (const value of Object.values(tools as Record<string, unknown>)) {
      if (typeof value === 'function') return true;
      if (value && typeof value === 'object' && typeof (value as { handler?: unknown }).handler === 'function') return true;
    }
  }
  return false;
}

type ToolSerializer<T> = (source: ProviderToolsOption<unknown>) => T[];

function injectTools<T>(body: Record<string, unknown>, tools: unknown, serialize: ToolSerializer<T>) {
  if (tools === undefined) return;

  if (isChorusToolsSource(tools)) {
    if (toToolDefinitionList(tools).length === 0) return;
    body.tools = serialize(tools);
    return;
  }

  if (Array.isArray(tools) && tools.length === 0) return;
  body.tools = tools;
}

export function stripOpenAIChatOptions<TMeta>(options: OpenAIChatCompletionsBodyOptions<TMeta>) {
  const { unsupportedAttachmentText: _unsupportedAttachmentText, stream = true, tools, ...rest } = options;
  void _unsupportedAttachmentText;
  const bodyOptions: Record<string, unknown> = { ...rest };
  injectTools(bodyOptions, tools, toOpenAIChatCompletionsTools);
  return { bodyOptions, stream };
}

export function stripOpenAIResponsesOptions<TMeta>(options: OpenAIResponsesBodyOptions<TMeta>) {
  const { unsupportedAttachmentText: _unsupportedAttachmentText, stream = true, tools, ...rest } = options;
  void _unsupportedAttachmentText;
  const bodyOptions: Record<string, unknown> = { ...rest };
  injectTools(bodyOptions, tools, toOpenAIResponsesTools);
  return { bodyOptions, stream };
}

export function stripAnthropicOptions<TMeta>(options: AnthropicMessagesBodyOptions<TMeta>) {
  const { unsupportedAttachmentText: _unsupportedAttachmentText, stream = true, tools, ...rest } = options;
  void _unsupportedAttachmentText;
  const bodyOptions: Record<string, unknown> = { ...rest };
  injectTools(bodyOptions, tools, toAnthropicTools);
  return { bodyOptions, stream };
}

export function stripGeminiOptions<TMeta>(options: GeminiGenerateContentBodyOptions<TMeta>) {
  const { unsupportedAttachmentText: _unsupportedAttachmentText, tools, ...rest } = options;
  void _unsupportedAttachmentText;
  const bodyOptions: Record<string, unknown> = { ...rest };
  injectTools(bodyOptions, tools, toGeminiTools);
  return bodyOptions;
}
