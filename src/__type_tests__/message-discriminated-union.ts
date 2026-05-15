import type { Message, ToolMessage } from '../index';

interface ToolMeta {
  traceId: string;
}

const toolOnlyMessage: ToolMessage<ToolMeta> = {
  id: 'tool-1',
  role: 'tool',
  metadata: { traceId: 'trace-1' },
  toolCall: { id: 'call-1', name: 'lookup', input: { q: 'chorus' } },
};

const messages: Message<ToolMeta>[] = [
  { id: 'user-1', role: 'user', text: 'Search', attachments: [] },
  { id: 'assistant-1', role: 'assistant', text: 'Calling lookup…' },
  toolOnlyMessage,
  { id: 'system-1', role: 'system', text: 'Be concise.' },
];

function renderCustomMessage(message: Message<ToolMeta>) {
  if (message.role === 'tool') {
    const name: string = message.toolCall.name;
    const traceId: string | undefined = message.metadata?.traceId;
    const text: string | undefined = message.text;
    void name;
    void traceId;
    void text;
    return;
  }

  const text: string = message.text;
  // @ts-expect-error toolCall is only present on tool messages.
  void message.toolCall.name;
  void text;
}

for (const message of messages) renderCustomMessage(message);

// @ts-expect-error tool messages require a toolCall.
const missingToolCall: Message = { id: 'bad-tool', role: 'tool', text: '' };
void missingToolCall;

// @ts-expect-error non-tool messages cannot carry a toolCall.
const userWithToolCall: Message = { id: 'bad-user', role: 'user', text: 'hi', toolCall: { name: 'lookup' } };
void userWithToolCall;

// @ts-expect-error system messages cannot carry attachments.
const systemWithAttachments: Message = { id: 'bad-system', role: 'system', text: 'policy', attachments: [] };
void systemWithAttachments;

// @ts-expect-error tool messages cannot carry attachments.
const toolWithAttachments: Message = { id: 'bad-tool-attachments', role: 'tool', toolCall: { name: 'lookup' }, attachments: [] };
void toolWithAttachments;
