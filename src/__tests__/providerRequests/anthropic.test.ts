import { describe, expect, it, vi } from 'vitest';
import { toAnthropicMessagesBody } from '../../providerRequests';
import type { Message } from '../../types';
import { history } from './fixtures';

describe('Anthropic provider request mapping', () => {
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

  it('trims surrounding whitespace from Anthropic tool-use ids', () => {
    const trimmedHistory: Message[] = [
      { id: 'assistant', role: 'assistant', text: 'Looking.' },
      {
        id: 'tool',
        role: 'tool',
        text: '',
        toolCall: { name: 'lookup', input: { q: 'x' }, output: 'ok' },
        metadata: { anthropic: { toolUseId: '\ttoolu_padded\n' } },
      },
    ];

    expect(toAnthropicMessagesBody(trimmedHistory).messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking.' },
          { type: 'tool_use', id: 'toolu_padded', name: 'lookup', input: { q: 'x' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_padded', content: 'ok' }] },
    ]);
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
});

describe('Anthropic system precedence', () => {
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

  it('keeps the caller system option without warning when the history has no system message', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const anthropic = toAnthropicMessagesBody([
        { id: 'user', role: 'user', text: 'Hello' },
      ], { model: 'claude-sonnet-4-6', max_tokens: 64, system: 'Only the caller system.' });
      expect(anthropic.system).toBe('Only the caller system.');

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
