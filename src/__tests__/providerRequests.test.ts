import { describe, expect, it, vi } from 'vitest';
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

  it('falls back to text for image attachments whose data URL has an empty base64 payload', () => {
    const emptyDataHistory = (): Message[] => [
      {
        id: 'user',
        role: 'user',
        text: 'Describe',
        attachments: [
          { name: 'stub.png', type: 'image/png', data: 'data:image/png;base64,', size: 0 },
        ],
      },
    ];

    expect(toOpenAIChatCompletionsBody(emptyDataHistory()).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe' },
          { type: 'text', text: '[Unsupported attachment omitted: stub.png (image/png)]' },
        ],
      },
    ]);

    expect(toOpenAIResponsesBody(emptyDataHistory()).input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Describe' },
          { type: 'input_text', text: '[Unsupported attachment omitted: stub.png (image/png)]' },
        ],
      },
    ]);

    expect(toAnthropicMessagesBody(emptyDataHistory()).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe' },
          { type: 'text', text: '[Unsupported attachment omitted: stub.png (image/png)]' },
        ],
      },
    ]);

    expect(toGeminiGenerateContentBody(emptyDataHistory()).contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'Describe' },
          { text: '[Unsupported attachment omitted: stub.png (image/png)]' },
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
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'abc' } },
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

  it('falls back to Anthropic text for non-PDF non-image attachments without a data URL', () => {
    const body = toAnthropicMessagesBody([
      {
        id: 'user',
        role: 'user',
        text: 'Listen',
        attachments: [
          { name: 'audio.mp3', type: 'audio/mpeg', data: '', size: 1 },
          { name: 'doc.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,zzz', size: 1 },
        ],
      },
    ]);
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Listen' },
          { type: 'text', text: '[Unsupported attachment omitted: audio.mp3 (audio/mpeg)]' },
          { type: 'text', text: '[Unsupported attachment omitted: doc.docx (application/vnd.openxmlformats-officedocument.wordprocessingml.document)]' },
        ],
      },
    ]);
  });

  it('flags Anthropic tool_result blocks with is_error: true when the tool message is marked errored', () => {
    const erroredHistory: Message[] = [
      { id: 'user', role: 'user', text: 'Use the tool' },
      { id: 'assistant', role: 'assistant', text: 'Calling.' },
      {
        id: 'errored-tool',
        role: 'tool',
        text: '',
        toolCall: { name: 'lookup', input: { q: 'x' }, output: { error: 'boom' } },
        metadata: { anthropic: { toolUseId: 'toolu_err', isError: true } },
      },
    ];

    expect(toAnthropicMessagesBody(erroredHistory, { model: 'claude-sonnet-4-6', max_tokens: 64 }).messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Use the tool' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Calling.' },
          { type: 'tool_use', id: 'toolu_err', name: 'lookup', input: { q: 'x' } },
        ],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_err',
          content: '{\n  "error": "boom"\n}',
          is_error: true,
        }],
      },
    ]);

    const rootMetaHistory: Message[] = [
      {
        id: 'single-tool',
        role: 'tool',
        text: '',
        toolCall: { name: 'lookup', output: { error: 'fail' } },
        metadata: { anthropic: { toolUseId: 'toolu_root' }, isError: true },
      },
    ];

    expect(toAnthropicMessagesBody(rootMetaHistory).messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_root', name: 'lookup', input: {} }],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_root',
          content: '{\n  "error": "fail"\n}',
          is_error: true,
        }],
      },
    ]);
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
            { inlineData: { mimeType: 'application/pdf', data: 'abc' } },
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

  it('maps uploaded non-image Gemini attachments to fileData', () => {
    expect(toGeminiGenerateContentBody([
      {
        id: 'user',
        role: 'user',
        text: 'Watch',
        attachments: [
          { name: 'clip.mp4', type: 'video/mp4', data: '', url: 'gs://bucket/clip.mp4', size: 1 },
          { name: 'paper.pdf', type: 'application/pdf', data: '', id: 'files/abc123', size: 1 },
        ],
      },
    ]).contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'Watch' },
          { fileData: { mimeType: 'video/mp4', fileUri: 'gs://bucket/clip.mp4' } },
          { fileData: { mimeType: 'application/pdf', fileUri: 'files/abc123' } },
        ],
      },
    ]);
  });

  it('falls back to Gemini text only when no data URL or uploaded URI is available', () => {
    expect(toGeminiGenerateContentBody([
      {
        id: 'user',
        role: 'user',
        text: 'Empty',
        attachments: [{ name: 'mystery.bin', type: 'application/octet-stream', data: '', size: 0 }],
      },
    ]).contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'Empty' },
          { text: '[Unsupported attachment omitted: mystery.bin (application/octet-stream)]' },
        ],
      },
    ]);
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

describe('attachment MIME allow-lists and system precedence', () => {
  it('routes Gemini data-URL attachments with an unsupported MIME type to text parts', () => {
    expect(toGeminiGenerateContentBody([
      {
        id: 'user',
        role: 'user',
        text: 'Parse this',
        attachments: [
          { name: 'rows.csv', type: 'text/csv', data: 'data:text/csv;base64,YSxiCjEsMg==', size: 8 },
        ],
      },
    ]).contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'Parse this' },
          { text: '[Unsupported attachment omitted: rows.csv (text/csv)]' },
        ],
      },
    ]);
  });

  it('prefers the Gemini data-URL header MIME over a mismatched attachment.type', () => {
    expect(toGeminiGenerateContentBody([
      {
        id: 'user',
        role: 'user',
        text: 'Describe',
        attachments: [
          { name: 'shot.png', type: 'image/png', data: 'data:image/jpeg;base64,aGVsbG8=', size: 5 },
        ],
      },
    ]).contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'Describe' },
          { inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } },
        ],
      },
    ]);
  });

  it('routes Anthropic image attachments with an unsupported MIME type to text blocks', () => {
    expect(toAnthropicMessagesBody([
      {
        id: 'user',
        role: 'user',
        text: 'Look',
        attachments: [
          { name: 'logo.svg', type: 'image/svg+xml', data: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', size: 9 },
          { name: 'pic.bmp', type: 'image/bmp', data: 'data:image/bmp;base64,Qk0=', size: 3 },
          { name: 'frame.png', type: 'image/png', data: 'data:image/png;base64,aGVsbG8=', size: 5 },
        ],
      },
    ]).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look' },
          { type: 'text', text: '[Unsupported attachment omitted: logo.svg (image/svg+xml)]' },
          { type: 'text', text: '[Unsupported attachment omitted: pic.bmp (image/bmp)]' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
        ],
      },
    ]);
  });

  it('lets a caller-provided Anthropic system option win over history system text, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const body = toAnthropicMessagesBody([
        { id: 'sys', role: 'system', text: 'History system instructions.' },
        { id: 'user', role: 'user', text: 'Hello' },
      ], { model: 'claude-sonnet-4-6', max_tokens: 64, system: 'Caller system instructions.' });

      expect(body.system).toBe('Caller system instructions.');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('caller-provided `system`');
    } finally {
      warn.mockRestore();
    }
  });

  it('lets a caller-provided Gemini systemInstruction win over history system text, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const callerSystemInstruction = { parts: [{ text: 'Caller system instructions.' }] };
      const body = toGeminiGenerateContentBody([
        { id: 'sys', role: 'system', text: 'History system instructions.' },
        { id: 'user', role: 'user', text: 'Hello' },
      ], { systemInstruction: callerSystemInstruction });

      expect(body.systemInstruction).toEqual(callerSystemInstruction);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('caller-provided `systemInstruction`');
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the caller system option without warning when the history has no system message', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const anthropic = toAnthropicMessagesBody([
        { id: 'user', role: 'user', text: 'Hello' },
      ], { model: 'claude-sonnet-4-6', max_tokens: 64, system: 'Only the caller system.' });
      expect(anthropic.system).toBe('Only the caller system.');

      const gemini = toGeminiGenerateContentBody([
        { id: 'user', role: 'user', text: 'Hello' },
      ], { systemInstruction: { parts: [{ text: 'Only the caller system.' }] } });
      expect(gemini.systemInstruction).toEqual({ parts: [{ text: 'Only the caller system.' }] });

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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
