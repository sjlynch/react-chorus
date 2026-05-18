import type { ChorusToolDefinition, ChorusToolRegistry } from '../tools';
import { toToolDefinitionList } from '../tools';

/** Source accepted by every `to*Tools` helper: definition array or full registry. */
export type ProviderToolsSource<TMeta = Record<string, unknown>> =
  | ChorusToolDefinition<TMeta>[]
  | ChorusToolRegistry<TMeta>;

function defaultObjectSchema(definition: ChorusToolDefinition<unknown>): Record<string, unknown> {
  return definition.inputSchema ?? { type: 'object', properties: {} };
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
    return {
      type: 'function',
      function: {
        name: definition.name,
        ...(description ? { description } : {}),
        parameters: defaultObjectSchema(definition as ChorusToolDefinition<unknown>),
        ...openai,
      },
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
    return {
      type: 'function',
      name: definition.name,
      ...(description ? { description } : {}),
      parameters: defaultObjectSchema(definition as ChorusToolDefinition<unknown>),
      ...openai,
    } as OpenAIResponsesTool;
  });
}

/** Serialize Chorus tool definitions into Anthropic Messages API `tools` entries. */
export function toAnthropicTools<TMeta = Record<string, unknown>>(
  source: ProviderToolsSource<TMeta>,
): AnthropicTool[] {
  return toToolDefinitionList(source).map(definition => {
    const { anthropic = {} } = definition;
    const description = definition.description;
    return {
      name: definition.name,
      ...(description ? { description } : {}),
      input_schema: defaultObjectSchema(definition as ChorusToolDefinition<unknown>),
      ...anthropic,
    } as AnthropicTool;
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
    return {
      name: definition.name,
      ...(description ? { description } : {}),
      parameters: defaultObjectSchema(definition as ChorusToolDefinition<unknown>),
      ...gemini,
    } as GeminiFunctionDeclaration;
  });

  return [{ functionDeclarations: declarations }];
}
