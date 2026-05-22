import { describe, expect, it, vi } from 'vitest';
import {
  RESERVED_SYSTEM_PROMPT_ID,
  defineTool,
  toAiSdkModelMessages,
  toAiSdkModelMessagesBody,
  toAiSdkTools,
} from '../../providerRequests';
import type { Message } from '../../types';

const imageData = 'data:image/png;base64,aGVsbG8=';

function dataUrlPayload(value: string) {
  return value.slice(value.indexOf(',') + 1);
}

describe('AI SDK provider request mapping', () => {
  it('preserves Chorus systemPrompt and host-authored system rows', () => {
    const history: Message[] = [
      { id: RESERVED_SYSTEM_PROMPT_ID, role: 'system', text: '  Be concise.  ' },
      { id: 'sys-host', role: 'system', text: 'Use metric units.' },
      { id: 'user', role: 'user', text: 'Hello' },
    ];

    expect(toAiSdkModelMessages(history)).toEqual([
      { role: 'system', content: 'Be concise.' },
      { role: 'system', content: 'Use metric units.' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('round-trips AI SDK tool-call ids, inputs, and results as model message parts', () => {
    const history: Message[] = [
      { id: 'assistant', role: 'assistant', text: 'I will check.', reasoning: 'Planning the lookup.' },
      {
        id: 'tool',
        role: 'tool',
        text: '',
        toolCall: { id: 'local-call-id', name: 'lookup', input: { q: 'react-chorus' }, output: { ok: true } },
        metadata: { aiSdk: { toolCallId: '  call_ai_sdk  ' } },
      },
    ];

    expect(toAiSdkModelMessages(history)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Planning the lookup.' },
          { type: 'text', text: 'I will check.' },
          { type: 'tool-call', toolCallId: 'call_ai_sdk', toolName: 'lookup', input: { q: 'react-chorus' } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_ai_sdk',
            toolName: 'lookup',
            output: { type: 'json', value: { ok: true } },
          },
        ],
      },
    ]);
  });

  it('uses toolCall.id when AI SDK metadata is absent so streamed connector rows stay structured', () => {
    const history: Message[] = [
      {
        id: 'tool',
        role: 'tool',
        text: '',
        toolCall: { id: 'call_from_tool', name: 'weather', input: { city: 'Paris' }, output: 'sunny' },
      },
    ];

    expect(toAiSdkModelMessages(history)).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call_from_tool', toolName: 'weather', input: { city: 'Paris' } }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call_from_tool', toolName: 'weather', output: { type: 'text', value: 'sunny' } }],
      },
    ]);
  });

  it('maps supported attachments to AI SDK image/file parts and falls back visibly for unsupported sources', () => {
    const history: Message[] = [
      {
        id: 'user',
        role: 'user',
        text: 'Review these',
        attachments: [
          { name: 'photo.png', type: 'image/png', data: imageData, size: 5 },
          { name: 'report.pdf', type: 'application/pdf', data: 'data:application/pdf;base64,JVBERi0=', size: 6 },
          { name: 'hosted.pdf', type: 'application/pdf', data: '', url: 'https://files.example.com/hosted.pdf', size: 7 },
          { name: 'blob.png', type: 'image/png', data: 'blob:https://example.com/blob', size: 1 },
        ],
      },
    ];

    expect(toAiSdkModelMessages(history)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Review these' },
          { type: 'image', image: dataUrlPayload(imageData), mediaType: 'image/png' },
          { type: 'file', data: 'JVBERi0=', mediaType: 'application/pdf', filename: 'report.pdf' },
          { type: 'file', data: new URL('https://files.example.com/hosted.pdf'), mediaType: 'application/pdf', filename: 'hosted.pdf' },
          { type: 'text', text: '[Unsupported attachment omitted: blob.png (image/png)]' },
        ],
      },
    ]);
  });

  it('builds an AI SDK messages body while preserving extra options and defaulting stream to true', () => {
    const history: Message[] = [{ id: 'user', role: 'user', text: 'Hello' }];

    expect(toAiSdkModelMessagesBody(history, { temperature: 0.2 })).toEqual({
      temperature: 0.2,
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    });
  });

  it('honors an explicit `stream: false` instead of defaulting to true', () => {
    const history: Message[] = [{ id: 'user', role: 'user', text: 'Hello' }];

    expect(toAiSdkModelMessagesBody(history, { stream: false })).toEqual({
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
    });
  });
});

describe('AI SDK system precedence', () => {
  it('lets a caller-provided AI SDK system option win over history system text, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const body = toAiSdkModelMessagesBody([
        { id: 'sys', role: 'system', text: 'History system instructions.' },
        { id: 'user', role: 'user', text: 'Hello' },
      ], { system: 'Caller system instructions.' });

      expect(body.system).toBe('Caller system instructions.');
      // History system rows continue to appear in `messages` since the AI SDK
      // convention is system-as-message; the warn-once flags the duplication.
      expect(body.messages).toEqual([
        { role: 'system', content: 'History system instructions.' },
        { role: 'user', content: 'Hello' },
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('caller-provided `system`');
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the caller system option without warning when the history has no system message', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const body = toAiSdkModelMessagesBody([
        { id: 'user', role: 'user', text: 'Hello' },
      ], { system: 'Only the caller system.' });

      expect(body.system).toBe('Only the caller system.');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('omits the top-level `system` field when no caller-provided value is set', () => {
    const body = toAiSdkModelMessagesBody([
      { id: 'sys', role: 'system', text: 'History system instructions.' },
      { id: 'user', role: 'user', text: 'Hello' },
    ]);

    expect(body).not.toHaveProperty('system');
  });
});

describe('AI SDK tool serialization', () => {
  const searchTool = defineTool({
    name: 'search',
    description: 'Search the docs',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    },
    handler: async () => 'ok',
  });

  it('serializes definitions into a Vercel AI SDK ToolSet record keyed by name', () => {
    expect(toAiSdkTools([searchTool])).toEqual({
      search: {
        type: 'function',
        description: 'Search the docs',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      },
    });
  });

  it('flows Chorus tool definitions through `toAiSdkModelMessagesBody` as the AI SDK `tools` record', () => {
    const body = toAiSdkModelMessagesBody([], { tools: [searchTool] });
    expect(body.tools).toEqual(toAiSdkTools([searchTool]));
  });

  it('forwards a raw array-shape tools value verbatim as the escape hatch', () => {
    const rawTools = [{ name: 'lookup', type: 'function', inputSchema: { type: 'object' } }];
    const body = toAiSdkModelMessagesBody([], {
      tools: rawTools,
    } as Parameters<typeof toAiSdkModelMessagesBody>[1]);
    expect(body.tools).toBe(rawTools);
  });

  it('accepts a Chorus registry record and re-keys the tool by its registry key', () => {
    const registry = {
      search: defineTool({
        name: 'will-be-overridden',
        description: 'Search the docs',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        handler: async () => null,
      }),
    };

    const body = toAiSdkModelMessagesBody([], { tools: registry });
    expect(body.tools).toEqual({
      search: {
        type: 'function',
        description: 'Search the docs',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      },
    });
  });

  it('omits tools entirely when an empty definition array is provided', () => {
    const body = toAiSdkModelMessagesBody([], { tools: [] });
    expect(body).not.toHaveProperty('tools');
  });
});
