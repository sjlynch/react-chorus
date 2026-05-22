import type { Message, MessageSource, Role } from '../types';
import { sourceDisplayLabel } from '../utils/messageSources';

export type TranscriptExportFormat = 'markdown' | 'json';

/** Default Markdown heading label for each message role. */
const DEFAULT_ROLE_LABELS: Record<Role, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
};

/**
 * Serialize a tool-call `input`/`output` value for search and export. Strings
 * pass through unchanged; everything else is pretty-printed JSON, falling back
 * to `String(value)` when it cannot be stringified (e.g. a circular structure).
 * Shared so `messageMatchesQuery` and `exportMarkdown` stay single-sourced.
 */
export function stringifyToolValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatSourceMarkdown(source: MessageSource, index: number): string {
  const label = sourceDisplayLabel(source, `Source ${index + 1}`);
  const title = source.url ? `[${label}](${source.url})` : label;
  return source.snippet ? `${title} — ${source.snippet}` : title;
}

function formatSourcesMarkdown(sources: MessageSource[] | undefined): string | null {
  if (!sources || sources.length === 0) return null;
  return ['**Sources:**', sources.map((source, index) => `- ${formatSourceMarkdown(source, index)}`).join('\n')].join('\n\n');
}

function sourceSearchText(source: MessageSource, index: number): string {
  return [sourceDisplayLabel(source, `Source ${index + 1}`), source.url, source.snippet]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n');
}

function sourcesMatchQuery(sources: MessageSource[] | undefined, needle: string): boolean {
  return Boolean(sources?.some((source, index) => sourceSearchText(source, index).toLowerCase().includes(needle)));
}

/**
 * Serialize one message for the built-in per-message Copy fallback. Unlike the
 * historical `message.text ?? ''` fallback, this includes structured tool I/O
 * and sources/citations so the copied text matches the non-text content the
 * default transcript renders and exports.
 */
export function formatMessageForClipboard<TMeta>(message: Message<TMeta>): string {
  const blocks: string[] = [];

  if (message.role === 'tool') {
    blocks.push(`Tool: ${message.toolCall.name}`);
    if (message.text) blocks.push(message.text);
    if (message.toolCall.input !== undefined) blocks.push('Input:', stringifyToolValue(message.toolCall.input));
    if (message.toolCall.output !== undefined) blocks.push('Output:', stringifyToolValue(message.toolCall.output));
  } else {
    if (message.text) blocks.push(message.text);
  }

  const sources = formatSourcesMarkdown(message.sources);
  if (sources) blocks.push(sources);
  return blocks.join('\n\n');
}

/**
 * Whether `message` matches `needle` (an already lower-cased, trimmed query).
 * Covers exactly the values `exportMarkdown` renders so search and export stay
 * in lockstep.
 */
export function messageMatchesQuery<TMeta>(message: Message<TMeta>, needle: string): boolean {
  if (message.text && message.text.toLowerCase().includes(needle)) return true;
  // exportMarkdown renders `reasoning` only for assistant messages (matching
  // the bubble), so scope the reasoning match the same way to keep search and
  // export in lockstep.
  if (message.role === 'assistant' && message.reasoning && message.reasoning.toLowerCase().includes(needle)) {
    return true;
  }
  // exportMarkdown lists each attachment as `- 📎 ${a.name}`, so a query for an
  // attached file name must find the message here too.
  if (message.attachments?.some((a) => a.name.toLowerCase().includes(needle))) return true;
  // Source title/url/snippet is rendered in the `**Sources:**` export block.
  if (sourcesMatchQuery(message.sources, needle)) return true;
  if (message.role === 'tool') {
    const { name, input, output } = message.toolCall;
    if (name.toLowerCase().includes(needle)) return true;
    // Tool I/O is often the substantive content in an agentic transcript and
    // exportAs renders it, so search the same serialized input/output here.
    if (input !== undefined && stringifyToolValue(input).toLowerCase().includes(needle)) return true;
    if (output !== undefined && stringifyToolValue(output).toLowerCase().includes(needle)) return true;
  }
  return false;
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
        // Reasoning is an assistant-only concept the bubble shows above the
        // answer; render it the same way so the export carries every value
        // searchMessages can match.
        if (message.role === 'assistant' && message.reasoning) {
          blocks.push('**Reasoning:**', message.reasoning);
        }
        if (message.text) blocks.push(message.text);
        const attachments = message.attachments;
        if (attachments && attachments.length > 0) {
          blocks.push(attachments.map((a) => `- 📎 ${a.name}`).join('\n'));
        }
      }

      const sources = formatSourcesMarkdown(message.sources);
      if (sources) blocks.push(sources);

      return blocks.join('\n\n');
    })
    .join('\n\n');
}

/** Pure transcript serializer shared by `exportAs`, `copyAll`, and `downloadAs`. */
export function exportTranscript<TMeta>(
  messages: Message<TMeta>[],
  format: TranscriptExportFormat,
  roleLabels?: Partial<Record<Role, string>>,
): string {
  return format === 'json' ? JSON.stringify(messages, null, 2) : exportMarkdown(messages, roleLabels);
}

/**
 * Pick the download file name. Defaults to `transcript.<ext>`; a caller name
 * with no extension gets the format's appended, while one that already has an
 * extension is honored as given.
 */
export function resolveDownloadFilename(extension: string, filename?: string): string {
  const trimmed = filename?.trim();
  if (!trimmed) return `transcript.${extension}`;
  return /\.[^./\\]+$/.test(trimmed) ? trimmed : `${trimmed}.${extension}`;
}
