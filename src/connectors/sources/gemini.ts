import type { MessageSource } from '../../types';
import { buildSource, isRecord, numberFrom, recordFrom, stringFrom, withDefinedMetadata } from './shared';

/**
 * Gemini `candidates[].groundingMetadata.groundingChunks` array. Each chunk is
 * `{ web: { uri, title } }` (Google Search grounding) or `{ retrievedContext:
 * { uri, title } }` (Vertex AI grounding). The neighbouring `groundingSupports`
 * array carries char-range references that point back into these chunks by
 * index, so we preserve the chunk index on metadata in case a caller wants to
 * re-anchor them.
 */
export function sourcesFromGeminiGroundingMetadata(metadata: unknown): MessageSource[] {
  if (!isRecord(metadata)) return [];
  const chunks = metadata.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const sources: MessageSource[] = [];
  chunks.forEach((chunk, chunkIndex) => {
    if (!isRecord(chunk)) return;
    const web = recordFrom(chunk.web);
    const retrieved = recordFrom(chunk.retrievedContext);
    const ref = web ?? retrieved;
    if (!ref) return;
    const url = stringFrom(ref.uri) ?? stringFrom(ref.url);
    const title = stringFrom(ref.title);
    const meta = withDefinedMetadata({
      provider: 'gemini',
      chunkKind: web ? 'web' : 'retrievedContext',
      chunkIndex,
    });
    const source = buildSource({
      id: url ?? (title ? `gemini-grounding-${chunkIndex}-${title}` : `gemini-grounding-${chunkIndex}`),
      type: 'url',
      title,
      url,
      metadata: meta,
    });
    if (source) sources.push(source);
  });
  return sources;
}

/**
 * Gemini `candidates[].citationMetadata` either as the documented
 * `{ citationSources: [...] }` (Google AI) or `{ citations: [...] }` (some
 * Vertex AI flavors). Each entry carries `{ startIndex, endIndex, uri, title,
 * license }` describing a span of the candidate's text that was copied from a
 * training source. Surface them so users see attribution alongside the
 * answer.
 */
export function sourcesFromGeminiCitationMetadata(metadata: unknown): MessageSource[] {
  if (!isRecord(metadata)) return [];
  const list = Array.isArray(metadata.citationSources)
    ? metadata.citationSources
    : Array.isArray(metadata.citations)
      ? metadata.citations
      : null;
  if (!list) return [];
  const sources: MessageSource[] = [];
  list.forEach((entry, entryIndex) => {
    if (!isRecord(entry)) return;
    const url = stringFrom(entry.uri) ?? stringFrom(entry.url);
    const title = stringFrom(entry.title);
    const meta = withDefinedMetadata({
      provider: 'gemini',
      citationKind: 'citationMetadata',
      startIndex: numberFrom(entry.startIndex),
      endIndex: numberFrom(entry.endIndex),
      license: stringFrom(entry.license),
      publicationDate: recordFrom(entry.publicationDate),
    });
    const source = buildSource({
      id: url ?? (title ? `gemini-citation-${entryIndex}-${title}` : `gemini-citation-${entryIndex}`),
      type: 'url',
      title,
      url,
      metadata: meta,
    });
    if (source) sources.push(source);
  });
  return sources;
}
