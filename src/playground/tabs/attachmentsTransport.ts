import type { Transport } from '../../hooks/useChorusStream';
import type { Message } from '../../types';
import { makeSSEResponse, sseDone, streamReasoningTokens, streamTextTokens } from './sseUtils';

function findLastUser(history: Message[]) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') return history[i];
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function describeAttachments(message: Message): { reasoning: string; text: string } {
  const attachments = (message.role === 'user' ? message.attachments : undefined) ?? [];
  if (attachments.length === 0) {
    return {
      reasoning: 'No attachments found on this turn — the user is asking without sharing an image.',
      text: 'I don\'t see any attachments on this turn. Drag an image into the chat, paste one (Ctrl/⌘+V), or use the **📎** button to attach a file, then ask again.',
    };
  }

  const lines = attachments.map((a, i) => `${i + 1}. **${a.name}** — \`${a.type || 'unknown/mime'}\`, ${formatBytes(a.size)}`);
  const reasoning = `Inspecting ${attachments.length} attachment${attachments.length === 1 ? '' : 's'} on the last user turn. (This is a mock — there's no real vision model here, just metadata.)`;

  const text = [
    `Got ${attachments.length} image${attachments.length === 1 ? '' : 's'}. Here's what the composer reported:`,
    '',
    ...lines,
    '',
    "In a real integration you'd forward these (as base64 data URLs, signed URLs, or provider file IDs depending on what your backend expects) to a vision-capable model. See the **End-to-end image attachment recipe** section of the README for OpenAI Chat Completions wiring.",
  ].join('\n');

  return { reasoning, text };
}

export const attachmentsTransport: Transport = (_text, history, signal) => {
  const last = findLastUser(history);
  const description = last
    ? describeAttachments(last)
    : { reasoning: 'No user message in history.', text: 'Say hello to get started.' };

  return makeSSEResponse(async function* (sig) {
    yield* streamReasoningTokens(description.reasoning, sig);
    yield* streamTextTokens(description.text, sig);
    yield sseDone();
  }, signal);
};
