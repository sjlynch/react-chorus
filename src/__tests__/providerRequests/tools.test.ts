import { describe, expect, it } from 'vitest';
import {
  defineTool,
  toAnthropicMessagesBody,
  toAnthropicTools,
  toGeminiGenerateContentBody,
  toGeminiTools,
  toOpenAIChatCompletionsBody,
  toOpenAIChatCompletionsTools,
  toOpenAIResponsesBody,
  toOpenAIResponsesTools,
} from '../../providerRequests';

describe('provider request tool definition serialization', () => {
  const searchTool = defineTool({
    name: 'search',
    description: 'Search the docs',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string', description: 'query text' } },
      required: ['q'],
    },
    handler: async (input) => ({ echo: input }),
  });

  const lookupTool = defineTool({
    name: 'lookup',
    handler: async () => 'ok',
    openai: { strict: true },
    anthropic: { cache_control: { type: 'ephemeral' } },
    gemini: { description: 'Gemini-specific description' },
  });

  it('serializes definitions into OpenAI Chat Completions tool entries', () => {
    expect(toOpenAIChatCompletionsTools([searchTool, lookupTool])).toEqual([
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search the docs',
          parameters: {
            type: 'object',
            properties: { q: { type: 'string', description: 'query text' } },
            required: ['q'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'lookup',
          parameters: { type: 'object', properties: {} },
          strict: true,
        },
      },
    ]);
  });

  it('serializes definitions into OpenAI Responses tool entries (flat shape)', () => {
    expect(toOpenAIResponsesTools([searchTool])).toEqual([
      {
        type: 'function',
        name: 'search',
        description: 'Search the docs',
        parameters: {
          type: 'object',
          properties: { q: { type: 'string', description: 'query text' } },
          required: ['q'],
        },
      },
    ]);
  });

  it('serializes definitions into Anthropic Messages tool entries with input_schema', () => {
    expect(toAnthropicTools([searchTool, lookupTool])).toEqual([
      {
        name: 'search',
        description: 'Search the docs',
        input_schema: {
          type: 'object',
          properties: { q: { type: 'string', description: 'query text' } },
          required: ['q'],
        },
      },
      {
        name: 'lookup',
        input_schema: { type: 'object', properties: {} },
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('wraps definitions in Gemini functionDeclarations', () => {
    expect(toGeminiTools([searchTool, lookupTool])).toEqual([{
      functionDeclarations: [
        {
          name: 'search',
          description: 'Search the docs',
          parameters: {
            type: 'object',
            properties: { q: { type: 'string', description: 'query text' } },
            required: ['q'],
          },
        },
        {
          name: 'lookup',
          description: 'Gemini-specific description',
          parameters: { type: 'object', properties: {} },
        },
      ],
    }]);
  });

  it('returns an empty array when no definitions are provided', () => {
    expect(toGeminiTools([])).toEqual([]);
    expect(toOpenAIChatCompletionsTools([])).toEqual([]);
    expect(toAnthropicTools([])).toEqual([]);
  });

  it('flows tool definitions through every body helper as the provider-specific tools field', () => {
    const tools = [searchTool];

    const chat = toOpenAIChatCompletionsBody([], { model: 'gpt-4o-mini', tools });
    expect(chat.tools).toEqual(toOpenAIChatCompletionsTools(tools));

    const responses = toOpenAIResponsesBody([], { model: 'gpt-4.1-mini', tools });
    expect(responses.tools).toEqual(toOpenAIResponsesTools(tools));

    const anthropic = toAnthropicMessagesBody([], { model: 'claude-sonnet-4-6', max_tokens: 256, tools });
    expect(anthropic.tools).toEqual(toAnthropicTools(tools));

    const gemini = toGeminiGenerateContentBody([], { tools });
    expect(gemini.tools).toEqual(toGeminiTools(tools));
  });

  it('treats raw provider-shaped tools as an escape hatch and passes them through', () => {
    const rawOpenAI = [{ type: 'function', function: { name: 'raw', parameters: {} } }];
    const chat = toOpenAIChatCompletionsBody([], { tools: rawOpenAI } as Parameters<typeof toOpenAIChatCompletionsBody>[1]);
    expect(chat.tools).toBe(rawOpenAI);

    const rawAnthropic = [{ name: 'raw', input_schema: { type: 'object' } }];
    const anthropic = toAnthropicMessagesBody([], { max_tokens: 8, tools: rawAnthropic } as Parameters<typeof toAnthropicMessagesBody>[1]);
    expect(anthropic.tools).toBe(rawAnthropic);

    const rawGemini = [{ functionDeclarations: [{ name: 'raw' }] }];
    const gemini = toGeminiGenerateContentBody([], { tools: rawGemini } as Parameters<typeof toGeminiGenerateContentBody>[1]);
    expect(gemini.tools).toBe(rawGemini);
  });

  it('accepts a Chorus tools registry record and serializes definition entries by key', () => {
    const registry = {
      search: defineTool({
        name: 'will-be-overridden',
        description: 'Search the docs',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        handler: async () => null,
      }),
    };

    const body = toOpenAIChatCompletionsBody([], { tools: registry });
    expect(body.tools).toEqual([{
      type: 'function',
      function: {
        name: 'search',
        description: 'Search the docs',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
      },
    }]);
  });

  it('omits tools entirely when the definition array is empty', () => {
    const body = toOpenAIChatCompletionsBody([], { model: 'gpt-4o-mini', tools: [] });
    expect(body).not.toHaveProperty('tools');
  });
});
