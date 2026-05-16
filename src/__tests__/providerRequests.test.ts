import { describe, expect, it } from 'vitest';
import {
  defineTool,
  formatAnthropicMessagesBody,
  formatGeminiGenerateContentBody,
  formatOpenAIChatCompletionsBody,
  formatOpenAIResponsesBody,
  toAnthropicMessagesBody,
  toAnthropicTools,
  toGeminiGenerateContentBody,
  toGeminiTools,
  toOpenAIChatCompletionsBody,
  toOpenAIChatCompletionsTools,
  toOpenAIResponsesBody,
  toOpenAIResponsesTools,
} from '../providerRequests';
import type { Message } from '../types';

const imageData = 'data:image/png;base64,aGVsbG8=';

function history(): Message[] {
  return [
    { id: 'sys', role: 'system', text: 'Be concise.' },
    {
      id: 'user',
      role: 'user',
      text: 'Describe this',
      attachments: [
        { name: 'photo.png', type: 'image/png', data: imageData, size: 5 },
        { name: 'notes.pdf', type: 'application/pdf', data: 'data:application/pdf;base64,abc', size: 3 },
      ],
    },
    { id: 'assistant', role: 'assistant', text: 'I will check.' },
    {
      id: 'tool',
      role: 'tool',
      text: '',
      toolCall: { name: 'lookup', input: { q: 'react-chorus' }, output: { ok: true } },
      metadata: { openai: { toolCallId: 'call_openai' }, anthropic: { toolUseId: 'toolu_1' } },
    },
  ];
}

function nonOpenAIUriImageHistory(): Message[] {
  return [
    {
      id: 'uri-user',
      role: 'user',
      text: 'Review attachments',
      attachments: [
        { name: 'gcs.png', type: 'image/png', data: 'gs://bucket/gcs.png', size: 1 },
        { name: 'local.jpg', type: 'image/jpeg', data: '', url: 'file:///tmp/local.jpg', size: 1 },
      ],
    },
  ];
}

describe('provider request mappers', () => {
  it('maps Chorus history to an OpenAI Chat Completions body', () => {
    expect(toOpenAIChatCompletionsBody(history(), { model: 'gpt-4o-mini' })).toEqual({
      model: 'gpt-4o-mini',
      stream: true,
      messages: [
        { role: 'system', content: 'Be concise.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            { type: 'image_url', image_url: { url: imageData } },
            { type: 'text', text: '[Unsupported attachment omitted: notes.pdf (application/pdf)]' },
          ],
        },
        {
          role: 'assistant',
          content: 'I will check.',
          tool_calls: [{
            id: 'call_openai',
            type: 'function',
            function: { name: 'lookup', arguments: '{"q":"react-chorus"}' },
          }],
        },
        { role: 'tool', tool_call_id: 'call_openai', content: '{\n  "ok": true\n}' },
      ],
    });
  });

  it('does not duplicate OpenAI Chat tool_calls already present on the preceding assistant', () => {
    const nativeToolCall = {
      id: 'call_openai',
      type: 'function',
      function: { name: 'lookup', arguments: '{"q":"react-chorus"}' },
    };
    const importedHistory: Message[] = [
      { id: 'user', role: 'user', text: 'Describe this' },
      { id: 'assistant', role: 'assistant', text: '', metadata: { openai: { toolCalls: [nativeToolCall] } } },
      {
        id: 'tool',
        role: 'tool',
        text: '',
        toolCall: { name: 'lookup', input: { q: 'react-chorus' }, output: { ok: true } },
        metadata: { openai: { toolCallId: 'call_openai' } },
      },
    ];

    expect(toOpenAIChatCompletionsBody(importedHistory).messages).toEqual([
      { role: 'user', content: 'Describe this' },
      { role: 'assistant', content: null, tool_calls: [nativeToolCall] },
      { role: 'tool', tool_call_id: 'call_openai', content: '{\n  "ok": true\n}' },
    ]);
  });

  it('synthesizes OpenAI Chat assistant tool_calls when the preceding assistant lacks them', () => {
    const body = toOpenAIChatCompletionsBody([
      { id: 'assistant', role: 'assistant', text: 'I will look.' },
      {
        id: 'tool',
        role: 'tool',
        text: '',
        toolCall: { name: 'lookup', input: { q: 'x' }, output: 'found' },
        metadata: { openai: { toolCallId: 'call_lookup' } },
      },
    ]);

    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: 'I will look.',
        tool_calls: [{
          id: 'call_lookup',
          type: 'function',
          function: { name: 'lookup', arguments: '{"q":"x"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call_lookup', content: 'found' },
    ]);
  });

  it('falls back to safe context for OpenAI tool messages without provider ids', () => {
    const body = toOpenAIChatCompletionsBody([
      {
        id: 'tool',
        role: 'tool',
        text: '',
        toolCall: { name: 'lookup', input: { q: 'x' }, output: { result: 1 } },
      },
    ]);

    expect(body.messages).toEqual([
      {
        role: 'system',
        content: 'Tool call lookup\nInput:\n{\n  "q": "x"\n}\nOutput:\n{\n  "result": 1\n}',
      },
    ]);
  });

  it('maps Chorus history to an OpenAI Responses body', () => {
    expect(toOpenAIResponsesBody(history(), { model: 'gpt-4.1-mini' })).toEqual({
      model: 'gpt-4.1-mini',
      stream: true,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: 'Be concise.' }] },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Describe this' },
            { type: 'input_image', image_url: imageData },
            { type: 'input_text', text: '[Unsupported attachment omitted: notes.pdf (application/pdf)]' },
          ],
        },
        { role: 'assistant', content: [{ type: 'output_text', text: 'I will check.' }] },
        { type: 'function_call', call_id: 'call_openai', name: 'lookup', arguments: '{"q":"react-chorus"}' },
        { type: 'function_call_output', call_id: 'call_openai', output: '{\n  "ok": true\n}' },
      ],
    });
  });

  it('omits non-OpenAI image URI schemes from OpenAI image fields', () => {
    expect(toOpenAIChatCompletionsBody(nonOpenAIUriImageHistory()).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Review attachments' },
          { type: 'text', text: '[Unsupported attachment omitted: gcs.png (image/png)]' },
          { type: 'text', text: '[Unsupported attachment omitted: local.jpg (image/jpeg)]' },
        ],
      },
    ]);

    expect(toOpenAIResponsesBody(nonOpenAIUriImageHistory()).input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Review attachments' },
          { type: 'input_text', text: '[Unsupported attachment omitted: gcs.png (image/png)]' },
          { type: 'input_text', text: '[Unsupported attachment omitted: local.jpg (image/jpeg)]' },
        ],
      },
    ]);
  });

  it('maps Chorus history to an Anthropic Messages body', () => {
    expect(toAnthropicMessagesBody(history(), { model: 'claude-sonnet-4-6', max_tokens: 512 })).toEqual({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      stream: true,
      system: 'Be concise.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
            { type: 'text', text: '[Unsupported attachment omitted: notes.pdf (application/pdf)]' },
          ],
        },
        { role: 'assistant', content: [
          { type: 'text', text: 'I will check.' },
          { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: { q: 'react-chorus' } },
        ] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{\n  "ok": true\n}' }] },
      ],
    });
  });

  it('maps Chorus history to a Gemini generateContent body', () => {
    expect(toGeminiGenerateContentBody(history(), { generationConfig: { temperature: 0.2 } })).toEqual({
      generationConfig: { temperature: 0.2 },
      systemInstruction: { parts: [{ text: 'Be concise.' }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Describe this' },
            { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
            { text: '[Unsupported attachment omitted: notes.pdf (application/pdf)]' },
          ],
        },
        {
          role: 'model',
          parts: [
            { text: 'I will check.' },
            { functionCall: { name: 'lookup', args: { q: 'react-chorus' } } },
          ],
        },
        { role: 'user', parts: [{ functionResponse: { name: 'lookup', response: { ok: true } } }] },
      ],
    });
  });

  it('groups consecutive Gemini tool messages into one functionCall/functionResponse exchange', () => {
    expect(toGeminiGenerateContentBody([
      { id: 'user', role: 'user', text: 'Use tools' },
      { id: 'assistant', role: 'assistant', text: 'Checking.' },
      {
        id: 'lookup-tool',
        role: 'tool',
        text: '',
        toolCall: { name: 'lookup', input: { q: 'react-chorus' }, output: { ok: true } },
      },
      {
        id: 'weather-tool',
        role: 'tool',
        text: '',
        toolCall: { name: 'weather', input: { city: 'Paris' }, output: 'sunny' },
      },
    ]).contents).toEqual([
      { role: 'user', parts: [{ text: 'Use tools' }] },
      {
        role: 'model',
        parts: [
          { text: 'Checking.' },
          { functionCall: { name: 'lookup', args: { q: 'react-chorus' } } },
          { functionCall: { name: 'weather', args: { city: 'Paris' } } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'lookup', response: { ok: true } } },
          { functionResponse: { name: 'weather', response: { content: 'sunny' } } },
        ],
      },
    ]);
  });

  it('falls back to safe Gemini text context for malformed tool messages without a name', () => {
    expect(toGeminiGenerateContentBody([
      {
        id: 'tool',
        role: 'tool',
        text: '',
        toolCall: { name: '', input: { q: 'x' }, output: { error: 'missing name' } },
      },
    ]).contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'Tool call tool\nInput:\n{\n  "q": "x"\n}\nOutput:\n{\n  "error": "missing name"\n}' }],
      },
    ]);
  });

  it('keeps non-OpenAI image URI schemes as Gemini fileData fileUris', () => {
    expect(toGeminiGenerateContentBody(nonOpenAIUriImageHistory()).contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'Review attachments' },
          { fileData: { mimeType: 'image/png', fileUri: 'gs://bucket/gcs.png' } },
          { fileData: { mimeType: 'image/jpeg', fileUri: 'file:///tmp/local.jpg' } },
        ],
      },
    ]);
  });

  it('returns JSON formatBody helpers for createFetchSSETransport', () => {
    const messages = history();
    expect(JSON.parse(String(formatOpenAIChatCompletionsBody({ model: 'gpt-4o-mini' })('ignored', messages)))).toEqual(
      toOpenAIChatCompletionsBody(messages, { model: 'gpt-4o-mini' }),
    );
    expect(JSON.parse(String(formatOpenAIResponsesBody({ model: 'gpt-4.1-mini' })('ignored', messages)))).toEqual(
      toOpenAIResponsesBody(messages, { model: 'gpt-4.1-mini' }),
    );
    expect(JSON.parse(String(formatAnthropicMessagesBody({ model: 'claude-sonnet-4-6', max_tokens: 512 })('ignored', messages)))).toEqual(
      toAnthropicMessagesBody(messages, { model: 'claude-sonnet-4-6', max_tokens: 512 }),
    );
    expect(JSON.parse(String(formatGeminiGenerateContentBody({ generationConfig: { temperature: 0.2 } })('ignored', messages)))).toEqual(
      toGeminiGenerateContentBody(messages, { generationConfig: { temperature: 0.2 } }),
    );
  });
});

describe('tool definition serialization', () => {
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
