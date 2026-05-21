import { describe, expect, it, vi } from 'vitest';
import { toGeminiGenerateContentBody } from '../../providerRequests';
import { history, nonOpenAIUriImageHistory } from './fixtures';

describe('Gemini provider request mapping', () => {
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
});

describe('Gemini system precedence', () => {
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
