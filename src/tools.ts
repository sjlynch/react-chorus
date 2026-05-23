import type { ChorusToolCallContext, ChorusToolHandler } from './hooks/useAssistantSession';

/**
 * Single source of truth for a tool: name, description, JSON Schema for the
 * input, optional provider overrides, and the local handler. Pass these to
 * `<Chorus tools={[...]} />` to execute calls locally, and to provider
 * request helpers (e.g. `toOpenAIChatCompletionsBody({ tools: [...] })`) to
 * advertise them to the model.
 */
export interface ChorusToolDefinition<TMeta = Record<string, unknown>, TInput = unknown> {
  name: string;
  description?: string;
  /** JSON Schema for the tool input. Serialized into OpenAI `parameters`, Anthropic `input_schema`, and Gemini `parameters`. */
  inputSchema?: Record<string, unknown>;
  /** Provider-specific overrides merged into the OpenAI tool declaration (Chat Completions and Responses). */
  openai?: Record<string, unknown>;
  /** Provider-specific overrides merged into the Anthropic tool declaration. */
  anthropic?: Record<string, unknown>;
  /** Provider-specific overrides merged into the Gemini functionDeclaration. */
  gemini?: Record<string, unknown>;
  /** Provider-specific overrides merged into the Vercel AI SDK `Tool` shape. */
  aiSdk?: Record<string, unknown>;
  /**
   * Mark this tool as requiring user approval before each invocation. With a
   * `toolPolicy` of `'ask'`, Chorus renders an approval card on the streamed
   * tool row and pauses execution until the user (or
   * `ChorusRef.respondToApproval`) decides. `'allow'` policy bypasses the gate;
   * `'deny'` records a denied tool-error result without executing. The reserved
   * UI tools (`__render_block`, `__artifact`, `__run_code`) are always exempt
   * because they have no side effects.
   */
  requiresApproval?: boolean;
  /** Local executor. Receives the parsed input and the same context object as `onToolCall`. */
  handler: (input: TInput, context: ChorusToolCallContext<TMeta>) => unknown | Promise<unknown>;
}

/**
 * Identity helper that preserves the declared `TInput` type inside `handler`
 * while keeping the rest of the definition narrow. Use it instead of typing
 * `as ChorusToolDefinition<...>` for better inference and editor hints.
 */
export function defineTool<TInput = unknown, TMeta = Record<string, unknown>>(
  definition: ChorusToolDefinition<TMeta, TInput>,
): ChorusToolDefinition<TMeta, TInput> {
  return definition;
}

/**
 * Map a registry entry — bare handler or full definition — onto the handler
 * that actually executes. Treats anything with a callable `.handler` as a
 * definition; everything else as a handler function.
 */
export function getToolHandler<TMeta>(
  entry: ChorusToolHandler<TMeta> | ChorusToolDefinition<TMeta> | undefined,
): ChorusToolHandler<TMeta> | undefined {
  if (!entry) return undefined;
  if (typeof entry === 'function') return entry;
  if (typeof entry.handler === 'function') return entry.handler as ChorusToolHandler<TMeta>;
  return undefined;
}

/**
 * Resolve a handler for the given tool name from either a `Record`-shaped
 * registry (legacy or hybrid) or an array of definitions. Array entries match
 * on `definition.name`; record entries match on key.
 */
export function resolveToolHandler<TMeta>(
  registry: ChorusToolRegistry<TMeta> | undefined,
  name: string,
): ChorusToolHandler<TMeta> | undefined {
  if (!registry) return undefined;
  if (Array.isArray(registry)) {
    return getToolHandler(registry.find(definition => definition.name === name));
  }
  return getToolHandler(registry[name]);
}

/**
 * Tools registry accepted by `<Chorus tools=...>`. Supports three shapes:
 * - `Record<string, ChorusToolHandler>` (legacy, handler-only)
 * - `Record<string, ChorusToolHandler | ChorusToolDefinition>` (mix)
 * - `ChorusToolDefinition[]` (array of definitions, name on the object)
 */
export type ChorusToolRegistry<TMeta = Record<string, unknown>> =
  | Record<string, ChorusToolHandler<TMeta> | ChorusToolDefinition<TMeta>>
  | ChorusToolDefinition<TMeta>[];

/**
 * Flatten any accepted registry shape into a deduplicated array of definitions
 * for serialization. Bare function handlers are skipped — they have no schema
 * to advertise — but a handler-less definition object is kept (the documented
 * server-side-execution escape hatch), mirroring the array-path filter. Record
 * keys override `definition.name` so the public tool name always matches the
 * dispatch key.
 */
export function toToolDefinitionList<TMeta>(
  registry: ChorusToolRegistry<TMeta> | ChorusToolDefinition<TMeta>[] | undefined,
): ChorusToolDefinition<TMeta>[] {
  if (!registry) return [];
  if (Array.isArray(registry)) return registry.filter(item => item && typeof item.name === 'string' && item.name.length > 0);

  const out: ChorusToolDefinition<TMeta>[] = [];
  for (const [name, entry] of Object.entries(registry)) {
    if (!name) continue;
    // Skip only bare function handlers: they carry no schema to advertise. Any
    // other value is a definition object — possibly handler-less — and is kept,
    // with the record key supplying `name`. Requiring a `handler` here dropped
    // pure-definition records, silently omitting the `tools` array.
    if (!entry || typeof entry === 'function') continue;
    out.push({ ...entry, name });
  }
  return out;
}
