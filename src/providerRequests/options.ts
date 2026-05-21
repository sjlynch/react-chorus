import type { Message } from '../types';
import { toToolDefinitionList } from '../tools';
import { warnOnceInDev } from './devWarn';
import type { ProviderToolsOption } from './types/common';
import type { AnthropicMessagesBodyOptions } from './types/anthropic';
import type { GeminiGenerateContentBodyOptions } from './types/gemini';
import type { OpenAIChatCompletionsBodyOptions } from './types/openaiChat';
import type { OpenAIResponsesBodyOptions } from './types/openaiResponses';
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

export function systemTextFromHistory(history: Message<unknown>[]) {
  const system = history
    .filter(message => message.role === 'system' && message.text.trim())
    .map(message => message.text)
    .join('\n\n');
  return system || undefined;
}

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
  // `system` is pulled out of `rest` so the caller-provided value is resolved
  // explicitly against history system text instead of silently leaking into
  // `bodyOptions` and being overwritten — see `resolveProviderSystem`.
  const { unsupportedAttachmentText: _unsupportedAttachmentText, stream = true, tools, system, ...rest } = options;
  void _unsupportedAttachmentText;
  const bodyOptions: Record<string, unknown> = { ...rest };
  injectTools(bodyOptions, tools, toAnthropicTools);
  return { bodyOptions, stream, system };
}

export function stripGeminiOptions<TMeta>(options: GeminiGenerateContentBodyOptions<TMeta>) {
  // `systemInstruction` is pulled out of `rest` for the same reason as
  // Anthropic's `system` above — see `resolveProviderSystem`.
  const { unsupportedAttachmentText: _unsupportedAttachmentText, tools, systemInstruction, ...rest } = options;
  void _unsupportedAttachmentText;
  const bodyOptions: Record<string, unknown> = { ...rest };
  injectTools(bodyOptions, tools, toGeminiTools);
  return { bodyOptions, systemInstruction };
}

/**
 * Resolve "system" precedence between a caller-supplied option (`system` for
 * Anthropic, `systemInstruction` for Gemini) and system text derived from
 * `role: 'system'` messages in the history.
 *
 * Documented precedence: when the caller passes the option explicitly, the
 * caller's value wins and history-derived system text is dropped. When both
 * sources are present a dev-mode warn-once fires so the dropped history text
 * is observable. With only one source present, that source is used.
 */
export function resolveProviderSystem(
  provider: 'Anthropic' | 'Gemini',
  field: 'system' | 'systemInstruction',
  callerSystem: unknown,
  historySystem: unknown,
): unknown {
  if (callerSystem === undefined) return historySystem;
  if (historySystem !== undefined) {
    warnOnceInDev(
      `react-chorus:${provider.toLowerCase()}-system-precedence`,
      `[react-chorus] ${provider} request received both a caller-provided \`${field}\` option and ` +
        `system message(s) in the conversation history. The caller-provided \`${field}\` takes ` +
        'precedence; the history system text is ignored.',
    );
  }
  return callerSystem;
}
