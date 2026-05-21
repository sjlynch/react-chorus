import { describe, expect, it, vi } from 'vitest';
import {
  toAnthropicMessagesBody,
  toGeminiGenerateContentBody,
  toOpenAIChatCompletionsBody,
  toOpenAIChatCompletionsTools,
  toOpenAIResponsesBody,
} from '../../providerRequests';
import type { Message } from '../../types';

function assistantWithAttachment(name: string): Message[] {
  return [
    {
      id: 'assistant',
      role: 'assistant',
      text: 'Here is the generated image',
      attachments: [{ name, type: 'image/png', data: 'data:image/png;base64,aGVsbG8=', size: 5 }],
    },
  ];
}

describe('Part A — assistant-role attachments are surfaced, not silently dropped', () => {
  it('emits an unsupported-attachment text block for an assistant attachment on every provider mapper', () => {
    expect(toAnthropicMessagesBody(assistantWithAttachment('a.png')).messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is the generated image' },
          { type: 'text', text: '[Unsupported attachment omitted: a.png (image/png)]' },
        ],
      },
    ]);

    expect(toGeminiGenerateContentBody(assistantWithAttachment('b.png')).contents).toEqual([
      {
        role: 'model',
        parts: [
          { text: 'Here is the generated image' },
          { text: '[Unsupported attachment omitted: b.png (image/png)]' },
        ],
      },
    ]);

    expect(toOpenAIResponsesBody(assistantWithAttachment('c.png')).input).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'output_text', text: 'Here is the generated image' },
          { type: 'output_text', text: '[Unsupported attachment omitted: c.png (image/png)]' },
        ],
      },
    ]);

    expect(toOpenAIChatCompletionsBody(assistantWithAttachment('d.png')).messages).toEqual([
      {
        role: 'assistant',
        content: 'Here is the generated image\n\n[Unsupported attachment omitted: d.png (image/png)]',
      },
    ]);
  });

  it('warns once in dev when an attachment is replaced with an unsupported-attachment text block', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      toAnthropicMessagesBody(assistantWithAttachment('warn-probe.png'));
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toContain('warn-probe.png');
      expect(message).toContain('unsupported-attachment text block');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('Part B — OpenAI Responses file mapper consults attachment.data', () => {
  it('maps an attachment whose uploaded URL landed in `.data` to a Responses input_file part', () => {
    expect(toOpenAIResponsesBody([
      {
        id: 'user',
        role: 'user',
        text: 'Review the doc',
        attachments: [
          { name: 'spec.pdf', type: 'application/pdf', data: 'https://files.example.com/spec.pdf', size: 1 },
        ],
      },
    ]).input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Review the doc' },
          { type: 'input_file', file_url: 'https://files.example.com/spec.pdf' },
        ],
      },
    ]);
  });
});

describe('Part C — handler-less Chorus tool arrays are serialized, not forwarded raw', () => {
  it('serializes a definition array whose items lack a handler through toToolDefinitionList', () => {
    const handlerlessTools = [
      { name: 'advertise', description: 'Executed server-side', parameters: { type: 'object', properties: {} } },
    ];

    const body = toOpenAIChatCompletionsBody([], {
      tools: handlerlessTools,
    } as Parameters<typeof toOpenAIChatCompletionsBody>[1]);

    expect(body.tools).toEqual(toOpenAIChatCompletionsTools(
      handlerlessTools as Parameters<typeof toOpenAIChatCompletionsTools>[0],
    ));
    expect(body.tools).not.toBe(handlerlessTools);
  });

  it('still forwards a genuinely raw provider tool array verbatim', () => {
    const rawAnthropic = [{ name: 'raw', input_schema: { type: 'object' } }];
    const body = toAnthropicMessagesBody([], {
      max_tokens: 8,
      tools: rawAnthropic,
    } as Parameters<typeof toAnthropicMessagesBody>[1]);
    expect(body.tools).toBe(rawAnthropic);
  });
});

describe('Part D — provider request mapper consistency fixes', () => {
  it('trims the OpenAI Chat Completions system message content', () => {
    expect(toOpenAIChatCompletionsBody([
      { id: 'sys', role: 'system', text: '  Be concise.  ' },
    ]).messages).toEqual([{ role: 'system', content: 'Be concise.' }]);
  });

  it('emits an OpenAI image `detail` hint from attachment.metadata.openai.imageDetail', () => {
    const detailHistory: Message[] = [
      {
        id: 'user',
        role: 'user',
        text: 'Describe',
        attachments: [
          {
            name: 'photo.png',
            type: 'image/png',
            data: 'data:image/png;base64,aGVsbG8=',
            size: 5,
            metadata: { openai: { imageDetail: 'low' } },
          },
        ],
      },
    ];

    expect(toOpenAIChatCompletionsBody(detailHistory).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=', detail: 'low' } },
        ],
      },
    ]);

    expect(toOpenAIResponsesBody(detailHistory).input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Describe' },
          { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=', detail: 'low' },
        ],
      },
    ]);
  });

  it('warns when a raw Gemini tool group has an empty functionDeclarations array', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const body = toGeminiGenerateContentBody([], {
        tools: [{ functionDeclarations: [] }],
      } as Parameters<typeof toGeminiGenerateContentBody>[1]);

      expect(body.tools).toEqual([{ functionDeclarations: [] }]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('functionDeclarations');
    } finally {
      warn.mockRestore();
    }
  });
});
