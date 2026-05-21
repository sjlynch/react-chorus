import { describe, expect, it } from 'vitest';
import {
  toOpenAIChatCompletionsBody,
  toOpenAIResponsesBody,
} from '../../providerRequests';
import type { Message } from '../../types';
import { history, imageData, nonOpenAIUriImageHistory } from './fixtures';

describe('OpenAI provider request mapping', () => {
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

  it('synthesizes a best-effort id for OpenAI tool messages without provider ids', () => {
    const toolMessage: Message = {
      id: 'tool',
      role: 'tool',
      text: '',
      toolCall: { name: 'lookup', input: { q: 'x' }, output: { result: 1 } },
    };

    // The structured tool call is preserved (not dropped or degraded to prose);
    // call and output share the synthesized id so they reference each other.
    expect(toOpenAIChatCompletionsBody([toolMessage]).messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'chorus_synth_tool',
          type: 'function',
          function: { name: 'lookup', arguments: '{"q":"x"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'chorus_synth_tool', content: '{\n  "result": 1\n}' },
    ]);

    expect(toOpenAIResponsesBody([toolMessage]).input).toEqual([
      { type: 'function_call', call_id: 'chorus_synth_tool', name: 'lookup', arguments: '{"q":"x"}' },
      { type: 'function_call_output', call_id: 'chorus_synth_tool', output: '{\n  "result": 1\n}' },
    ]);
  });

  it('trims surrounding whitespace from OpenAI tool-call ids', () => {
    const trimmedHistory: Message[] = [
      { id: 'assistant', role: 'assistant', text: 'Looking.' },
      {
        id: 'tool',
        role: 'tool',
        text: '',
        toolCall: { name: 'lookup', input: { q: 'x' }, output: 'ok' },
        metadata: { openai: { toolCallId: '  call_padded  ' } },
      },
    ];

    expect(toOpenAIChatCompletionsBody(trimmedHistory).messages).toEqual([
      {
        role: 'assistant',
        content: 'Looking.',
        tool_calls: [{ id: 'call_padded', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_padded', content: 'ok' },
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

  it('maps uploaded non-image attachments to OpenAI Responses input_file parts', () => {
    expect(toOpenAIResponsesBody([
      {
        id: 'user',
        role: 'user',
        text: 'Review docs',
        attachments: [
          { name: 'report.pdf', type: 'application/pdf', data: '', id: 'file_abc', size: 1 },
          { name: 'spec.pdf', type: 'application/pdf', data: '', url: 'https://files.example.com/spec.pdf', size: 1 },
          { name: 'inline.pdf', type: 'application/pdf', data: 'data:application/pdf;base64,xyz', size: 1 },
        ],
      },
    ]).input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Review docs' },
          { type: 'input_file', file_id: 'file_abc' },
          { type: 'input_file', file_url: 'https://files.example.com/spec.pdf' },
          { type: 'input_text', text: '[Unsupported attachment omitted: inline.pdf (application/pdf)]' },
        ],
      },
    ]);
  });

  it('keeps OpenAI Chat Completions image-only when given a non-image attachment', () => {
    expect(toOpenAIChatCompletionsBody([
      {
        id: 'user',
        role: 'user',
        text: 'Review docs',
        attachments: [
          { name: 'report.pdf', type: 'application/pdf', data: '', id: 'file_abc', size: 1 },
          { name: 'spec.pdf', type: 'application/pdf', data: '', url: 'https://files.example.com/spec.pdf', size: 1 },
        ],
      },
    ]).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Review docs' },
          { type: 'text', text: '[Unsupported attachment omitted: report.pdf (application/pdf)]' },
          { type: 'text', text: '[Unsupported attachment omitted: spec.pdf (application/pdf)]' },
        ],
      },
    ]);
  });

  it('forwards relative image URLs verbatim to OpenAI image fields', () => {
    const relativeHistory = (): Message[] => [
      {
        id: 'rel-user',
        role: 'user',
        text: 'Look at this',
        attachments: [
          { name: 'a.png', type: 'image/png', url: '/uploads/a.png', data: '/uploads/a.png', size: 1 },
          { name: 'b.png', type: 'image/png', url: './local/b.png', data: '', size: 1 },
        ],
      },
    ];

    expect(toOpenAIChatCompletionsBody(relativeHistory()).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this' },
          { type: 'image_url', image_url: { url: '/uploads/a.png' } },
          { type: 'image_url', image_url: { url: './local/b.png' } },
        ],
      },
    ]);

    expect(toOpenAIResponsesBody(relativeHistory()).input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Look at this' },
          { type: 'input_image', image_url: '/uploads/a.png' },
          { type: 'input_image', image_url: './local/b.png' },
        ],
      },
    ]);
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

  it('routes OpenAI image attachments by the data-URL header MIME, not a mismatched attachment.type', () => {
    // A generic upload pipeline often relabels an image as
    // `application/octet-stream` (or leaves `type` empty). The base64 `data:`
    // header is authoritative — the same routing Anthropic and Gemini use — so
    // OpenAI Chat and Responses must still deliver these as images.
    const relabeledImageHistory = (): Message[] => [
      {
        id: 'relabel-user',
        role: 'user',
        text: 'Describe these',
        attachments: [
          { name: 'octet', type: 'application/octet-stream', data: 'data:image/png;base64,aGVsbG8=', size: 5 },
          { name: 'blank', type: '', data: 'data:image/jpeg;base64,d29ybGQ=', size: 5 },
        ],
      },
    ];

    expect(toOpenAIChatCompletionsBody(relabeledImageHistory()).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe these' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,d29ybGQ=' } },
        ],
      },
    ]);

    expect(toOpenAIResponsesBody(relabeledImageHistory()).input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Describe these' },
          { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' },
          { type: 'input_image', image_url: 'data:image/jpeg;base64,d29ybGQ=' },
        ],
      },
    ]);
  });
});

describe('OpenAI tool-call arguments are always valid JSON', () => {
  function toolCallHistory(input: unknown): Message[] {
    return [
      { id: 'assistant', role: 'assistant', text: 'On it.' },
      {
        id: 'tool',
        role: 'tool',
        text: '',
        toolCall: { name: 'web_search', input, output: 'done' },
        metadata: { openai: { toolCallId: 'call_search' } },
      },
    ];
  }

  function chatToolArguments(toolHistory: Message[]): string {
    const messages = toOpenAIChatCompletionsBody(toolHistory).messages as Array<{
      tool_calls?: { function: { arguments: string } }[];
    }>;
    const toolCall = messages.flatMap(message => message.tool_calls ?? [])[0];
    if (!toolCall) throw new Error('expected an assistant tool_call');
    return toolCall.function.arguments;
  }

  function responsesToolArguments(toolHistory: Message[]): string {
    const input = toOpenAIResponsesBody(toolHistory).input as Array<{ type?: string; arguments?: string }>;
    const call = input.find(item => item.type === 'function_call');
    if (!call?.arguments) throw new Error('expected a function_call item');
    return call.arguments;
  }

  it('wraps a plain-text Chat Completions tool input so arguments stays valid JSON', () => {
    const plain = 'the text search the docs';
    const args = chatToolArguments(toolCallHistory(plain));

    expect(args).not.toBe(plain);
    expect(() => JSON.parse(args)).not.toThrow();
    expect(JSON.parse(args)).toEqual({ input: plain });
  });

  it('wraps a plain-text Responses function_call input so arguments stays valid JSON', () => {
    const plain = 'the text search the docs';
    const args = responsesToolArguments(toolCallHistory(plain));

    expect(args).not.toBe(plain);
    expect(() => JSON.parse(args)).not.toThrow();
    expect(JSON.parse(args)).toEqual({ input: plain });
  });

  it('passes through a string that already encodes a JSON object verbatim', () => {
    const json = '{"q":"react-chorus"}';

    expect(chatToolArguments(toolCallHistory(json))).toBe(json);
    expect(responsesToolArguments(toolCallHistory(json))).toBe(json);
  });

  it('still serializes structured object inputs as compact JSON', () => {
    expect(chatToolArguments(toolCallHistory({ q: 'x' }))).toBe('{"q":"x"}');
    expect(responsesToolArguments(toolCallHistory({ q: 'x' }))).toBe('{"q":"x"}');
  });
});
