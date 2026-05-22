import { describe, expect, it } from 'vitest';
import {
  toAnthropicMessagesBody,
  toAnthropicTools,
  toGeminiGenerateContentBody,
  toGeminiTools,
  toOpenAIChatCompletionsBody,
  toOpenAIChatCompletionsTools,
  toOpenAIResponsesBody,
  toOpenAIResponsesTools,
} from '../../providerRequests';
import type { Message } from '../../types';

// A `ChorusToolRegistry` permits `Record<string, ChorusToolHandler | ChorusToolDefinition>`,
// so a record whose values are all handler-less definitions (no `handler` — the
// documented server-side-execution escape hatch) is a valid registry shape. The
// definitions omit `handler`, so the record is cast at the call sites the same
// way the existing raw / handler-less suites cast their escape-hatch inputs.
type ChatToolsOption = Parameters<typeof toOpenAIChatCompletionsBody>[1];
type ResponsesToolsOption = Parameters<typeof toOpenAIResponsesBody>[1];
type AnthropicToolsOption = Parameters<typeof toAnthropicMessagesBody>[1];
type GeminiToolsOption = Parameters<typeof toGeminiGenerateContentBody>[1];
type ToolsSource = Parameters<typeof toOpenAIChatCompletionsTools>[0];

describe('Part 1 — handler-less record-shaped tool registry is serialized, never dropped or forwarded raw', () => {
  // Every value is a handler-less `ChorusToolDefinition` — a valid registry
  // shape. Previously `toToolDefinitionList` required `typeof handler === 'function'`
  // on the record path, so this serialized to an empty list (the `tools` array
  // was silently omitted), and `isChorusToolsSource` did not recognize it, so
  // `injectTools` forwarded the bare record object on `tools` (a provider 400).
  const handlerlessRegistry = {
    search: {
      name: 'search',
      description: 'Search the docs',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    },
    lookup: {
      name: 'lookup',
      description: 'Look something up',
    },
  };

  it('serializes every record entry into the OpenAI Chat Completions `tools` array', () => {
    const body = toOpenAIChatCompletionsBody([], { tools: handlerlessRegistry } as ChatToolsOption);

    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).not.toBe(handlerlessRegistry);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search the docs',
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
        },
      },
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Look something up',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
    expect(body.tools).toEqual(toOpenAIChatCompletionsTools(handlerlessRegistry as ToolsSource));
  });

  it('serializes every record entry into the OpenAI Responses, Anthropic, and Gemini `tools` arrays', () => {
    const responses = toOpenAIResponsesBody([], { tools: handlerlessRegistry } as ResponsesToolsOption);
    expect(Array.isArray(responses.tools)).toBe(true);
    expect(responses.tools).not.toBe(handlerlessRegistry);
    expect(responses.tools).toEqual(toOpenAIResponsesTools(handlerlessRegistry as ToolsSource));
    expect(responses.tools).toHaveLength(2);

    const anthropic = toAnthropicMessagesBody([], { max_tokens: 16, tools: handlerlessRegistry } as AnthropicToolsOption);
    expect(Array.isArray(anthropic.tools)).toBe(true);
    expect(anthropic.tools).not.toBe(handlerlessRegistry);
    expect(anthropic.tools).toEqual(toAnthropicTools(handlerlessRegistry as ToolsSource));
    expect(anthropic.tools).toHaveLength(2);

    const gemini = toGeminiGenerateContentBody([], { tools: handlerlessRegistry } as GeminiToolsOption);
    expect(Array.isArray(gemini.tools)).toBe(true);
    expect(gemini.tools).not.toBe(handlerlessRegistry);
    expect(gemini.tools).toEqual(toGeminiTools(handlerlessRegistry as ToolsSource));
    // Gemini wraps every declaration in a single `functionDeclarations` group.
    expect(gemini.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'search',
            description: 'Search the docs',
            parameters: { type: 'object', properties: { q: { type: 'string' } } },
          },
          {
            name: 'lookup',
            description: 'Look something up',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
    ]);
  });

  it('never forwards a bare record object on `tools` for any provider mapper', () => {
    const bodies = [
      toOpenAIChatCompletionsBody([], { tools: handlerlessRegistry } as ChatToolsOption),
      toOpenAIResponsesBody([], { tools: handlerlessRegistry } as ResponsesToolsOption),
      toAnthropicMessagesBody([], { max_tokens: 16, tools: handlerlessRegistry } as AnthropicToolsOption),
      toGeminiGenerateContentBody([], { tools: handlerlessRegistry } as GeminiToolsOption),
    ];
    for (const body of bodies) {
      expect(body).toHaveProperty('tools');
      expect(Array.isArray(body.tools)).toBe(true);
      expect(body.tools).not.toBe(handlerlessRegistry);
    }
  });
});

describe('Part 2 — provider-request mappers serialize the same input identically', () => {
  it('honors an explicit empty-string `toolCall.output` across all four mappers', () => {
    // `toolCall.output` is explicitly `''`; the streamed `text` is partial and
    // must never leak into the tool result. Pre-fix, `safeStringify('') || text`
    // fell through to `text` for OpenAI Chat/Responses/Anthropic — Gemini alone
    // honored the empty string via `toolOutputValue`.
    const streamed = 'partial streamed text that must not leak';
    const history: Message[] = [
      {
        id: 't-empty-output',
        role: 'tool',
        text: streamed,
        toolCall: { name: 'echo', input: { q: 'hi' }, output: '' },
        metadata: { openai: { toolCallId: 'call_1' }, anthropic: { toolUseId: 'tu_1' } },
      },
    ];

    const chat = toOpenAIChatCompletionsBody(history);
    expect(chat.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'echo', arguments: '{"q":"hi"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '' },
    ]);

    const responses = toOpenAIResponsesBody(history);
    expect(responses.input).toEqual([
      { type: 'function_call', call_id: 'call_1', name: 'echo', arguments: '{"q":"hi"}' },
      { type: 'function_call_output', call_id: 'call_1', output: '' },
    ]);

    const anthropic = toAnthropicMessagesBody(history);
    expect(anthropic.messages).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'echo', input: { q: 'hi' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '' }] },
    ]);

    const gemini = toGeminiGenerateContentBody(history);
    expect(gemini.contents).toEqual([
      { role: 'model', parts: [{ functionCall: { name: 'echo', args: { q: 'hi' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'echo', response: { content: '' } } }] },
    ]);

    // No mapper leaks the streamed partial text into the request body.
    for (const body of [chat, responses, anthropic, gemini]) {
      expect(JSON.stringify(body)).not.toContain(streamed);
    }
  });

  it('keeps a structured tool call when `toolCall.name` is an empty string across all four mappers', () => {
    // An empty-string `name` previously routed the Gemini tool message to the
    // prose fallback while OpenAI Chat/Responses/Anthropic kept the structured
    // call named `tool`. All four now resolve the empty name to `tool`.
    const history: Message[] = [
      {
        id: 't-empty-name',
        role: 'tool',
        text: '',
        toolCall: { name: '', input: { city: 'NYC' }, output: 'sunny' },
        metadata: { openai: { toolCallId: 'call_2' }, anthropic: { toolUseId: 'tu_2' } },
      },
    ];

    expect(toOpenAIChatCompletionsBody(history).messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'tool', arguments: '{"city":"NYC"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_2', content: 'sunny' },
    ]);

    expect(toOpenAIResponsesBody(history).input).toEqual([
      { type: 'function_call', call_id: 'call_2', name: 'tool', arguments: '{"city":"NYC"}' },
      { type: 'function_call_output', call_id: 'call_2', output: 'sunny' },
    ]);

    expect(toAnthropicMessagesBody(history).messages).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_2', name: 'tool', input: { city: 'NYC' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'sunny' }] },
    ]);

    // The Gemini tool message stays structured (functionCall + functionResponse)
    // instead of degrading to a `{ text: 'Tool call ...' }` prose part.
    expect(toGeminiGenerateContentBody(history).contents).toEqual([
      { role: 'model', parts: [{ functionCall: { name: 'tool', args: { city: 'NYC' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'tool', response: { content: 'sunny' } } }] },
    ]);
  });

  it('trims whitespace-padded `role: "system"` text identically across all four mappers', () => {
    // Pre-fix, `systemTextFromHistory` filtered on trimmed text but emitted the
    // untrimmed value, so padding survived into the Anthropic `system` string
    // and the Gemini `systemInstruction` — diverging from the trimming
    // Chat Completions and content-part mappers.
    const history: Message[] = [
      { id: 'sys', role: 'system', text: '  Be concise.  \n' },
      { id: 'u', role: 'user', text: 'Hi' },
    ];

    expect(toOpenAIChatCompletionsBody(history).messages).toContainEqual({
      role: 'system',
      content: 'Be concise.',
    });
    expect(toOpenAIResponsesBody(history).input).toContainEqual({
      role: 'system',
      content: [{ type: 'input_text', text: 'Be concise.' }],
    });
    expect(toAnthropicMessagesBody(history).system).toBe('Be concise.');
    expect(toGeminiGenerateContentBody(history).systemInstruction).toEqual({
      parts: [{ text: 'Be concise.' }],
    });
  });
});
