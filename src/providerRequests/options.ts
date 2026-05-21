import type { Message } from '../types';
import { toToolDefinitionList } from '../tools';
import { warnOnceInDev } from './devWarn';
import { isRecord } from './metadata';
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

// Marker keys that identify a *raw provider* tool array entry, never present on
// a `ChorusToolDefinition`: raw OpenAI tools carry `type`/`function`, raw
// Anthropic tools carry `input_schema`, and raw Gemini groups carry
// `functionDeclarations`. Any of these marks the array as the escape hatch.
const RAW_PROVIDER_TOOL_KEYS = ['type', 'function', 'input_schema', 'functionDeclarations'];

/**
 * Detect a single `ChorusToolDefinition`-shaped array item. A definition with a
 * `handler` is unambiguous; a handler-less definition (tools advertised for
 * server-side execution) is still recognized by a non-empty string `name` and
 * the absence of any raw provider-tool marker key — so a Chorus definition
 * array is serialized via `toToolDefinitionList` rather than forwarded raw.
 */
function isChorusToolDefinitionItem(item: unknown): boolean {
  if (!isRecord(item)) return false;
  if (typeof item.handler === 'function') return true;
  if (typeof item.name !== 'string' || !item.name) return false;
  return RAW_PROVIDER_TOOL_KEYS.every(key => !(key in item));
}

/**
 * Tools is Chorus-shaped when it's an array of `ChorusToolDefinition`-shaped
 * items (with or without a `handler`) or a record whose values are functions /
 * objects with `handler`. Plain provider tool arrays (OpenAI/Anthropic/Gemini
 * shapes) fall through as the escape hatch.
 */
function isChorusToolsSource(tools: unknown): tools is ProviderToolsOption<unknown> {
  if (Array.isArray(tools)) {
    return tools.some(isChorusToolDefinitionItem);
  }
  if (tools && typeof tools === 'object') {
    for (const value of Object.values(tools as Record<string, unknown>)) {
      if (typeof value === 'function') return true;
      if (value && typeof value === 'object' && typeof (value as { handler?: unknown }).handler === 'function') return true;
    }
  }
  return false;
}

/**
 * Warn (once, in dev) when a raw Gemini tool array contains a group with an
 * empty `functionDeclarations` array — Gemini rejects that with an opaque 400
 * and no Chorus-side diagnostic otherwise.
 */
function warnEmptyGeminiToolGroups(tools: unknown[]): void {
  const hasEmptyGroup = tools.some(
    group => isRecord(group) && Array.isArray(group.functionDeclarations) && group.functionDeclarations.length === 0,
  );
  if (!hasEmptyGroup) return;
  warnOnceInDev(
    'react-chorus:gemini-empty-function-declarations',
    '[react-chorus] Gemini request received a raw tool group with an empty `functionDeclarations` array. ' +
      'Gemini rejects this with an opaque 400 — remove the empty group or pass Chorus tool definitions instead.',
  );
}

type ToolSerializer<T> = (source: ProviderToolsOption<unknown>) => T[];

export function systemTextFromHistory(history: Message<unknown>[]) {
  const system = history
    .filter(message => message.role === 'system' && message.text.trim())
    .map(message => message.text)
    .join('\n\n');
  return system || undefined;
}

function injectTools<T>(
  body: Record<string, unknown>,
  tools: unknown,
  serialize: ToolSerializer<T>,
  validateRawTools?: (tools: unknown[]) => void,
) {
  if (tools === undefined) return;

  if (isChorusToolsSource(tools)) {
    if (toToolDefinitionList(tools).length === 0) return;
    body.tools = serialize(tools);
    return;
  }

  if (Array.isArray(tools)) {
    if (tools.length === 0) return;
    validateRawTools?.(tools);
  }
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
  injectTools(bodyOptions, tools, toGeminiTools, warnEmptyGeminiToolGroups);
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
