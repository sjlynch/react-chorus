import { describe, expect, it } from 'vitest';
import {
  formatAnthropicMessagesBody,
  formatGeminiGenerateContentBody,
  formatOpenAIChatCompletionsBody,
  formatOpenAIResponsesBody,
  toAnthropicMessagesBody,
  toGeminiGenerateContentBody,
  toOpenAIChatCompletionsBody,
  toOpenAIResponsesBody,
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
        { role: 'model', parts: [{ text: 'I will check.' }] },
        { role: 'user', parts: [{ functionResponse: { name: 'lookup', response: { ok: true } } }] },
      ],
    });
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
