import React from 'react';
import type { Message, Role } from '../types';
import { writeTextToClipboard } from '../utils/messageCopy';
import { useLatestRef } from './useLatestRef';

export type TranscriptExportFormat = 'markdown' | 'json';

/** Default Markdown heading label for each message role. */
const DEFAULT_ROLE_LABELS: Record<Role, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
};

export interface ChorusTranscriptActionsOptions {
  /** Override the Markdown heading label used for each role. Unset roles keep their default. */
  roleLabels?: Partial<Record<Role, string>>;
  /** Called when `copyAll()` cannot reach the Clipboard API or the write rejects. */
  onCopyError?: (error: Error) => void;
}

export interface ChorusTranscriptActions<TMeta = Record<string, unknown>> {
  /**
   * Case-insensitive substring search across each message's `text`, `reasoning`,
   * and (for tool messages) `toolCall.name`. Returns `[]` for a blank query.
   */
  searchMessages(query: string): Message<TMeta>[];
  /**
   * Copy the whole transcript to the clipboard. Defaults to Markdown; pass
   * `'json'` for the raw structure. Resolves `false` when the Clipboard API is
   * unavailable or the write rejects (and calls `onCopyError`).
   */
  copyAll(format?: TranscriptExportFormat): Promise<boolean>;
  /**
   * Serialize the transcript. `'json'` round-trips through
   * `JSON.parse(JSON.stringify(messages))`; `'markdown'` renders a readable
   * transcript with one heading per message.
   */
  exportAs(format: TranscriptExportFormat): string;
}

function messageMatchesQuery<TMeta>(message: Message<TMeta>, needle: string): boolean {
  if (message.text && message.text.toLowerCase().includes(needle)) return true;
  if (message.reasoning && message.reasoning.toLowerCase().includes(needle)) return true;
  if (message.role === 'tool' && message.toolCall.name.toLowerCase().includes(needle)) return true;
  return false;
}

function stringifyToolValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function exportMarkdown<TMeta>(messages: Message<TMeta>[], roleLabels?: Partial<Record<Role, string>>): string {
  return messages
    .map((message) => {
      const label = roleLabels?.[message.role] ?? DEFAULT_ROLE_LABELS[message.role];
      const blocks: string[] = [];

      if (message.role === 'tool') {
        const { name, input, output } = message.toolCall;
        blocks.push(`## ${label}: ${name}`);
        if (input !== undefined) blocks.push('**Input:**', '```json\n' + stringifyToolValue(input) + '\n```');
        if (output !== undefined) blocks.push('**Output:**', '```json\n' + stringifyToolValue(output) + '\n```');
        if (message.text) blocks.push(message.text);
      } else {
        blocks.push(`## ${label}`);
        if (message.text) blocks.push(message.text);
        const attachments = message.attachments;
        if (attachments && attachments.length > 0) {
          blocks.push(attachments.map((a) => `- 📎 ${a.name}`).join('\n'));
        }
      }

      return blocks.join('\n\n');
    })
    .join('\n\n');
}

/** Pure transcript serializer shared by `exportAs` and `copyAll`. */
function exportTranscript<TMeta>(
  messages: Message<TMeta>[],
  format: TranscriptExportFormat,
  roleLabels?: Partial<Record<Role, string>>,
): string {
  return format === 'json' ? JSON.stringify(messages, null, 2) : exportMarkdown(messages, roleLabels);
}

/**
 * Headless transcript utilities — search, copy-all, and Markdown/JSON export —
 * for building a search box, "copy conversation", or "download transcript"
 * affordance around `<Chorus>` or a headless shell. Pass the same `messages`
 * array you render (e.g. from `chorusRef.getMessages()`, `onMessagesChange`,
 * or your own state). The returned callbacks have stable identities.
 */
export function useChorusTranscriptActions<TMeta = Record<string, unknown>>(
  messages: Message<TMeta>[],
  options?: ChorusTranscriptActionsOptions,
): ChorusTranscriptActions<TMeta> {
  const messagesRef = useLatestRef(messages);
  const optionsRef = useLatestRef(options);

  const searchMessages = React.useCallback(
    (query: string) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      return messagesRef.current.filter((message) => messageMatchesQuery(message, needle));
    },
    [messagesRef],
  );

  const exportAs = React.useCallback(
    (format: TranscriptExportFormat) => exportTranscript(messagesRef.current, format, optionsRef.current?.roleLabels),
    [messagesRef, optionsRef],
  );

  const copyAll = React.useCallback(
    (format: TranscriptExportFormat = 'markdown') => {
      const text = exportTranscript(messagesRef.current, format, optionsRef.current?.roleLabels);
      return writeTextToClipboard(text, optionsRef.current?.onCopyError);
    },
    [messagesRef, optionsRef],
  );

  return React.useMemo(
    () => ({ searchMessages, copyAll, exportAs }),
    [searchMessages, copyAll, exportAs],
  );
}
