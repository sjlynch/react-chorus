import type { Message } from '../../types';

export const imageData = 'data:image/png;base64,aGVsbG8=';

export function history(): Message[] {
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

export function nonOpenAIUriImageHistory(): Message[] {
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

export function emptyDataHistory(): Message[] {
  return [
    {
      id: 'user',
      role: 'user',
      text: 'Describe',
      attachments: [
        { name: 'stub.png', type: 'image/png', data: 'data:image/png;base64,', size: 0 },
      ],
    },
  ];
}
