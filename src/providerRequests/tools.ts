import type { ChorusToolDefinition, ChorusToolRegistry } from '../tools';
import { toToolDefinitionList } from '../tools';
import { warnOnceInDev } from './devWarn';

/** Source accepted by every `to*Tools` helper: definition array or full registry. */
export type ProviderToolsSource<TMeta = Record<string, unknown>> =
  | ChorusToolDefinition<TMeta>[]
  | ChorusToolRegistry<TMeta>;

function defaultObjectSchema(definition: ChorusToolDefinition<unknown>): Record<string, unknown> {
  return definition.inputSchema ?? { type: 'object', properties: {} };
}

/**
 * Apply a per-provider override (`openai`/`anthropic`/`gemini`) on top of the
 * canonical tool fields, then re-assert `identity` so the override can never
 * clobber it. The override hatch is for *additive* provider fields (`strict`,
 * `cache_control`, ...); placing an identity field (`name`, `parameters`,
 * `input_schema`) inside it would silently rename the tool or replace its
 * validated schema, desyncing it from the Chorus dispatch key the rest of the
 * library matches on. Such misuse re-asserts the canonical value and warns once
 * in dev so it stays observable.
 */
function withToolOverride<T extends Record<string, unknown>>(
  provider: string,
  base: Record<string, unknown>,
  override: Record<string, unknown>,
  identity: Record<string, unknown>,
): T {
  for (const key of Object.keys(identity)) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      const toolName = String(identity.name ?? base.name ?? 'tool');
      warnOnceInDev(
        `react-chorus:tool-override-identity:${provider}:${toolName}:${key}`,
        `[react-chorus] ${provider} tools: the provider override on tool "${toolName}" sets the ` +
          `identity field \`${key}\`. The override hatch is for additive provider fields ` +
          `(e.g. strict, cache_control), not identity fields; the canonical \`${key}\` was kept.`,
      );
    }
  }
  return { ...base, ...override, ...identity } as T;
}

/** OpenAI Chat Completions tool declaration shape — `{ type: 'function', function: { ... } }`. */
export interface OpenAIChatCompletionsTool extends Record<string, unknown> {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** OpenAI Responses API tool declaration shape — `{ type: 'function', name, ... }` (no `function` wrapper). */
export interface OpenAIResponsesTool extends Record<string, unknown> {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/** Anthropic Messages tool declaration shape. */
export interface AnthropicTool extends Record<string, unknown> {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

/** Gemini `functionDeclaration` shape — wrap the result in `[{ functionDeclarations: ... }]` for the `tools` field. */
export interface GeminiFunctionDeclaration extends Record<string, unknown> {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiToolGroup extends Record<string, unknown> {
  functionDeclarations: GeminiFunctionDeclaration[];
}

/** Serialize Chorus tool definitions into OpenAI Chat Completions `tools` entries. */
export function toOpenAIChatCompletionsTools<TMeta = Record<string, unknown>>(
  source: ProviderToolsSource<TMeta>,
): OpenAIChatCompletionsTool[] {
  return toToolDefinitionList(source).map(definition => {
    const { openai = {} } = definition;
    const description = definition.description;
    const name = definition.name;
    const parameters = defaultObjectSchema(definition as ChorusToolDefinition<unknown>);
    return {
      type: 'function',
      function: withToolOverride(
        'OpenAI Chat Completions',
        { name, ...(description ? { description } : {}), parameters },
        openai,
        { name, parameters },
      ),
    } as OpenAIChatCompletionsTool;
  });
}

/** Serialize Chorus tool definitions into OpenAI Responses API `tools` entries. */
export function toOpenAIResponsesTools<TMeta = Record<string, unknown>>(
  source: ProviderToolsSource<TMeta>,
): OpenAIResponsesTool[] {
  return toToolDefinitionList(source).map(definition => {
    const { openai = {} } = definition;
    const description = definition.description;
    const name = definition.name;
    const parameters = defaultObjectSchema(definition as ChorusToolDefinition<unknown>);
    return withToolOverride<OpenAIResponsesTool>(
      'OpenAI Responses',
      { type: 'function', name, ...(description ? { description } : {}), parameters },
      openai,
      { name, parameters },
    );
  });
}

/** Serialize Chorus tool definitions into Anthropic Messages API `tools` entries. */
export function toAnthropicTools<TMeta = Record<string, unknown>>(
  source: ProviderToolsSource<TMeta>,
): AnthropicTool[] {
  return toToolDefinitionList(source).map(definition => {
    const { anthropic = {} } = definition;
    const description = definition.description;
    const name = definition.name;
    const input_schema = defaultObjectSchema(definition as ChorusToolDefinition<unknown>);
    return withToolOverride<AnthropicTool>(
      'Anthropic',
      { name, ...(description ? { description } : {}), input_schema },
      anthropic,
      { name, input_schema },
    );
  });
}

/** Serialize Chorus tool definitions into a single Gemini tool group with `functionDeclarations`. */
export function toGeminiTools<TMeta = Record<string, unknown>>(
  source: ProviderToolsSource<TMeta>,
): GeminiToolGroup[] {
  const list = toToolDefinitionList(source);
  if (!list.length) return [];

  const declarations = list.map(definition => {
    const { gemini = {} } = definition;
    const description = definition.description;
    const name = definition.name;
    const parameters = defaultObjectSchema(definition as ChorusToolDefinition<unknown>);
    return withToolOverride<GeminiFunctionDeclaration>(
      'Gemini',
      { name, ...(description ? { description } : {}), parameters },
      gemini,
      { name, parameters },
    );
  });

  return [{ functionDeclarations: declarations }];
}
