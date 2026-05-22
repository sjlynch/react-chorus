import type { MessageSource } from '../types';

/**
 * Pick the human-readable label for a source/citation, falling back to
 * `fallback` (e.g. `Source 3`) when the source carries no title/url/id.
 *
 * This UI/transcript-facing helper lives apart from `messageSources.ts`
 * (`appendMessageSource`, imported only by the assistant-session buffer) on
 * purpose: `MessageSources` (chat-window) and `transcriptFormatters` import it,
 * and co-locating it with the buffer helper would group it into — and make the
 * ChatWindow/transcript graph statically pull in — the chorus-session chunk.
 * See `libraryManualChunks` in vite.config.ts.
 */
export function sourceDisplayLabel(source: MessageSource, fallback: string): string {
  return source.title || source.url || source.id || fallback;
}
