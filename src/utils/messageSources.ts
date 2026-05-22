import type { MessageSource } from '../types';

function sourceKey(source: MessageSource): string | null {
  if (source.id) return `id:${source.id}`;
  if (source.url) return `url:${source.url}`;
  if (source.title && source.snippet) return `title-snippet:${source.title}\n${source.snippet}`;
  if (source.title) return `title:${source.title}`;
  return null;
}

function mergeSource(existing: MessageSource, incoming: MessageSource): MessageSource {
  return {
    id: incoming.id ?? existing.id,
    type: incoming.type ?? existing.type,
    title: incoming.title ?? existing.title,
    url: incoming.url ?? existing.url,
    snippet: incoming.snippet ?? existing.snippet,
    metadata: existing.metadata || incoming.metadata
      ? { ...(existing.metadata ?? {}), ...(incoming.metadata ?? {}) }
      : undefined,
  };
}

/**
 * Append a source/citation to a message, merging duplicate provider frames by
 * id/url/title so streamed annotation repeats do not render or export twice.
 */
export function appendMessageSource(existing: MessageSource[] | undefined, source: MessageSource): MessageSource[] {
  const key = sourceKey(source);
  if (!key) return [...(existing ?? []), source];

  const next = [...(existing ?? [])];
  const index = next.findIndex(item => sourceKey(item) === key);
  if (index === -1) {
    next.push(source);
    return next;
  }

  const existingSource = next[index];
  if (!existingSource) {
    next.push(source);
    return next;
  }
  next[index] = mergeSource(existingSource, source);
  return next;
}

export function sourceDisplayLabel(source: MessageSource, fallback: string): string {
  return source.title || source.url || source.id || fallback;
}
