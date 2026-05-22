import type { Message, SystemMessage } from '../types';
import { toToolDefinitionList } from '../tools';
import { warnOnceInDev } from './devWarn';
import { isRecord } from './metadata';
import type { ProviderToolsOption } from './types/common';
import type { AiSdkModelMessagesBodyOptions } from './types/aiSdk';
import type { AnthropicMessagesBodyOptions } from './types/anthropic';
import type { GeminiGenerateContentBodyOptions } from './types/gemini';
import type { OpenAIChatCompletionsBodyOptions } from './types/openaiChat';
import type { OpenAIResponsesBodyOptions } from './types/openaiResponses';
import {
  toAiSdkTools,
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
 * items (with or without a `handler`) or a record whose values are handler
 * functions or definition objects (again, with or without a `handler`). Plain
 * provider tool arrays (OpenAI/Anthropic/Gemini shapes) fall through as the
 * escape hatch — a record is always a Chorus registry, never a raw escape hatch.
 */
function isChorusToolsSource(tools: unknown): tools is ProviderToolsOption<unknown> {
  if (Array.isArray(tools)) {
    return tools.some(isChorusToolDefinitionItem);
  }
  if (tools && typeof tools === 'object') {
    // A record registry's values are handler functions or definition objects;
    // a definition may be handler-less (the server-side-execution escape
    // hatch), so recognizing only `handler` functions here misrouted a
    // pure-definition record to the raw branch, forwarding a bare object on
    // `tools`. Stays consistent with `toToolDefinitionList`, which keeps every
    // non-function object record entry.
    for (const value of Object.values(tools as Record<string, unknown>)) {
      if (typeof value === 'function') return true;
      if (value && typeof value === 'object') return true;
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

// `R` is the serialized provider-tools shape — an array for OpenAI/Anthropic/Gemini
// and a record for the AI SDK `ToolSet`. `injectTools` only assigns the result
// to `body.tools`, so the shape itself can be anything the provider accepts.
type ToolSerializer<R> = (source: ProviderToolsOption<unknown>) => R;

export function systemTextFromHistory(history: Message<unknown>[]) {
  // Emit the *trimmed* system text: the emptiness filter already trims, but the
  // mapped value must trim too so leading/trailing whitespace never survives
  // into the Anthropic `system` string or the Gemini `systemInstruction` —
  // matching `chatCompletions.ts` and `messageTextParts`, which both trim.
  const system = history
    .filter((message): message is SystemMessage<unknown> => message.role === 'system' && Boolean(message.text.trim()))
    .map(message => message.text.trim())
    .join('\n\n');
  return system || undefined;
}

function injectTools<R>(
  body: Record<string, unknown>,
  tools: unknown,
  serialize: ToolSerializer<R>,
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

export function stripAiSdkOptions<TMeta>(options: AiSdkModelMessagesBodyOptions<TMeta>) {
  // `system` is pulled out of `rest` so the caller-provided value is resolved
  // explicitly against history system text instead of silently leaking into
  // `bodyOptions` and being overwritten — see `resolveProviderSystem`.
  const { unsupportedAttachmentText: _unsupportedAttachmentText, stream = true, tools, system, ...rest } = options;
  void _unsupportedAttachmentText;
  const bodyOptions: Record<string, unknown> = { ...rest };
  injectTools(bodyOptions, tools, toAiSdkTools);
  return { bodyOptions, stream, system };
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
  provider: 'Anthropic' | 'Gemini' | 'AI SDK',
  field: 'system' | 'systemInstruction',
  callerSystem: unknown,
  historySystem: unknown,
): unknown {
  if (callerSystem === undefined) return historySystem;
  if (historySystem !== undefined) {
    // Slugify the provider name for the warn-once key so 'AI SDK' becomes
    // 'ai-sdk' rather than 'ai sdk', matching the existing key convention.
    const providerKey = provider.toLowerCase().replace(/\s+/g, '-');
    warnOnceInDev(
      `react-chorus:${providerKey}-system-precedence`,
      `[react-chorus] ${provider} request received both a caller-provided \`${field}\` option and ` +
        `system message(s) in the conversation history. The caller-provided \`${field}\` takes ` +
        'precedence; the history system text is ignored.',
    );
  }
  return callerSystem;
}
