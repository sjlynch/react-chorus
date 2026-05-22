import React from 'react';
import type { Message, Role } from '../types';
import { writeTextToClipboard } from '../utils/messageCopy';
import { useLatestRef } from './useLatestRef';
import {
  exportTranscript,
  messageMatchesQuery,
  resolveDownloadFilename,
  type TranscriptExportFormat,
} from './transcriptFormatters';

export type { TranscriptExportFormat };

/** MIME type and default file extension for a {@link TranscriptExportFormat}. */
export interface TranscriptFormatInfo {
  /** MIME type for a `Blob`/download (`text/markdown` or `application/json`). */
  mimeType: string;
  /** Default file extension, without the leading dot (`md` or `json`). */
  extension: string;
}

/**
 * MIME type and default file extension per {@link TranscriptExportFormat}.
 * `downloadAs` uses this, and it is exported so a host that builds its own
 * download (or upload) can pick the right `Blob` type / file name too.
 */
export const TRANSCRIPT_FORMAT_INFO: Record<TranscriptExportFormat, TranscriptFormatInfo> = {
  markdown: { mimeType: 'text/markdown', extension: 'md' },
  json: { mimeType: 'application/json', extension: 'json' },
};

export interface ChorusTranscriptActionsOptions {
  /** Override the Markdown heading label used for each role. Unset roles keep their default. */
  roleLabels?: Partial<Record<Role, string>>;
  /** Called when `copyAll()` cannot reach the Clipboard API or the write rejects. */
  onCopyError?: (error: Error) => void;
}

export interface ChorusTranscriptActions<TMeta = Record<string, unknown>> {
  /**
   * Case-insensitive substring search across each message's `text`, each
   * attachment's file `name`, each source/citation's title/url/snippet, the
   * `reasoning` of assistant messages, and — for tool messages —
   * `toolCall.name` plus its serialized `input` and `output`. These are
   * exactly the values `exportAs` renders, so a query
   * that matches the export matches here and vice versa. Returns `[]` for a
   * blank query.
   */
  searchMessages(query: string): Message<TMeta>[];
  /**
   * Copy the whole transcript to the clipboard. Defaults to Markdown; pass
   * `'json'` for the raw structure. Resolves `false` without touching the
   * clipboard when the transcript is empty (a non-error signal a host can use
   * to disable a "copy conversation" button — `onCopyError` is not called).
   * Also resolves `false`, and calls `onCopyError`, when the Clipboard API is
   * unavailable or the write rejects.
   */
  copyAll(format?: TranscriptExportFormat): Promise<boolean>;
  /**
   * Serialize the transcript. `'json'` round-trips through
   * `JSON.parse(JSON.stringify(messages))`; `'markdown'` renders a readable
   * transcript with one heading per message, including sources/citations and tool I/O.
   */
  exportAs(format: TranscriptExportFormat): string;
  /**
   * Serialize the transcript and save it to a file by triggering a transient
   * `<a download>` — the host needs no `Blob`/`createObjectURL`/anchor/
   * `revokeObjectURL` wiring of its own. `filename` defaults to `transcript`
   * plus the format's extension (`transcript.md` / `transcript.json`); a
   * `filename` with no extension gets the format's appended, while one that
   * already has an extension is used as given. Returns `false` without
   * downloading when the transcript is empty or no DOM is available (e.g.
   * server-side rendering), and `true` once the download has been triggered.
   */
  downloadAs(format: TranscriptExportFormat, filename?: string): boolean;
}

/**
 * Headless transcript utilities — search, copy-all, Markdown/JSON export, and
 * file download — for building a search box, "copy conversation", or "download
 * transcript" affordance around `<Chorus>` or a headless shell. Pass the same
 * `messages` array you render (e.g. from `chorusRef.getMessages()`,
 * `onMessagesChange`, or your own state). The returned callbacks have stable
 * identities.
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
      const currentMessages = messagesRef.current;
      // An empty transcript exports to '' (markdown) or '[]' (json); writing
      // either would silently report success on a "copy conversation" button.
      // Resolve false without touching the clipboard so the host can disable
      // it — this is not an error, so onCopyError is intentionally not called.
      if (currentMessages.length === 0) return Promise.resolve(false);
      const text = exportTranscript(currentMessages, format, optionsRef.current?.roleLabels);
      return writeTextToClipboard(text, optionsRef.current?.onCopyError);
    },
    [messagesRef, optionsRef],
  );

  const downloadAs = React.useCallback(
    (format: TranscriptExportFormat, filename?: string): boolean => {
      const currentMessages = messagesRef.current;
      // Mirror copyAll: an empty transcript has nothing worth saving, so skip
      // the download (and the misleading empty file) and report it via false.
      if (currentMessages.length === 0) return false;
      // Downloading needs a DOM and Blob URLs; bail cleanly under SSR or any
      // non-browser host instead of throwing.
      if (
        typeof document === 'undefined' ||
        typeof URL === 'undefined' ||
        typeof URL.createObjectURL !== 'function'
      ) {
        return false;
      }
      const { mimeType, extension } = TRANSCRIPT_FORMAT_INFO[format];
      const text = exportTranscript(currentMessages, format, optionsRef.current?.roleLabels);
      const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = resolveDownloadFilename(extension, filename);
        anchor.rel = 'noopener';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        // Revoke after the click so the browser has captured the blob; a 0ms
        // timeout is enough and avoids leaking the object URL.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      return true;
    },
    [messagesRef, optionsRef],
  );

  return React.useMemo(
    () => ({ searchMessages, copyAll, exportAs, downloadAs }),
    [searchMessages, copyAll, exportAs, downloadAs],
  );
}
