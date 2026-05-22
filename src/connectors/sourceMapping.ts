import type { MessageSource, MessageSourceType } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function recordFrom(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function withDefinedMetadata(entries: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeSourceType(value: unknown, fallback: MessageSourceType = 'unknown'): MessageSourceType {
  const raw = stringFrom(value)?.toLowerCase();
  if (!raw) return fallback;
  if (raw.includes('url') || raw === 'web') return 'url';
  if (raw.includes('document') || raw === 'doc') return 'document';
  if (raw.includes('file') || raw === 'container_file_citation' || raw === 'file_citation' || raw === 'file_path') return 'file';
  return fallback;
}

function sourceHasRenderableData(source: MessageSource): boolean {
  // An id-only annotation is useful for provider bookkeeping but not for the
  // transcript: rendering/exporting a lone opaque id looks like protocol noise.
  return Boolean(source.url || source.title || source.snippet);
}

function buildSource(source: MessageSource): MessageSource | null {
  return sourceHasRenderableData(source) ? source : null;
}

export function sourceFromAiSdkUiFrame(obj: Record<string, unknown>): MessageSource | null {
  const type = stringFrom(obj.type);
  if (type !== 'source-url' && type !== 'source-document') return null;
  const isUrl = type === 'source-url';
  const metadata = withDefinedMetadata({
    provider: 'ai-sdk',
    mediaType: obj.mediaType,
    filename: obj.filename,
  });
  return buildSource({
    id: stringFrom(obj.sourceId) ?? stringFrom(obj.id),
    type: isUrl ? 'url' : 'document',
    title: stringFrom(obj.title) ?? stringFrom(obj.filename) ?? stringFrom(obj.name),
    url: stringFrom(obj.url),
    snippet: stringFrom(obj.snippet) ?? stringFrom(obj.text) ?? stringFrom(obj.content),
    metadata,
  });
}

export function sourceFromAiSdkDataStream(value: unknown): MessageSource | null {
  if (typeof value === 'string') {
    const isUrl = value.startsWith('http://') || value.startsWith('https://');
    return buildSource({
      type: isUrl ? 'url' : 'unknown',
      url: isUrl ? value : undefined,
      title: isUrl ? undefined : value,
    });
  }
  if (!isRecord(value)) return null;
  const sourceType = normalizeSourceType(value.sourceType ?? value.type, stringFrom(value.url) ? 'url' : 'document');
  const metadata = withDefinedMetadata({
    provider: 'ai-sdk',
    mediaType: value.mediaType,
    filename: value.filename,
    page: value.page,
  });
  return buildSource({
    id: stringFrom(value.sourceId) ?? stringFrom(value.id),
    type: sourceType,
    title: stringFrom(value.title) ?? stringFrom(value.filename) ?? stringFrom(value.name),
    url: stringFrom(value.url),
    snippet: stringFrom(value.snippet) ?? stringFrom(value.text) ?? stringFrom(value.content),
    metadata,
  });
}

export function extractSourcesFromUnknown(value: unknown): MessageSource[] {
  if (Array.isArray(value)) return value.flatMap(extractSourcesFromUnknown);
  if (!isRecord(value)) return [];

  const nested = [value.sources, value.citations, value.annotations]
    .flatMap(extractSourcesFromUnknown);

  const direct = sourceFromAiSdkDataStream(value);
  if (direct) nested.unshift(direct);
  return nested;
}

export function sourcesFromAiSdkMetadataFrame(obj: Record<string, unknown>): MessageSource[] {
  if (obj.type !== 'message-metadata') return [];
  return extractSourcesFromUnknown(obj.messageMetadata ?? obj.metadata ?? obj.data);
}

export function sourceFromOpenAIResponseAnnotation(annotation: unknown): MessageSource | null {
  if (!isRecord(annotation)) return null;
  const rawType = stringFrom(annotation.type ?? annotation.sourceType);
  const type = normalizeSourceType(rawType, stringFrom(annotation.url) ? 'url' : 'unknown');
  const metadata = withDefinedMetadata({
    provider: 'openai',
    annotationType: rawType,
    startIndex: numberFrom(annotation.start_index),
    endIndex: numberFrom(annotation.end_index),
    index: numberFrom(annotation.index),
    fileId: annotation.file_id,
    containerId: annotation.container_id,
  });
  return buildSource({
    id: stringFrom(annotation.id) ?? stringFrom(annotation.file_id) ?? stringFrom(annotation.url),
    type,
    title: stringFrom(annotation.title) ?? stringFrom(annotation.filename) ?? stringFrom(annotation.file_name) ?? stringFrom(annotation.name),
    url: stringFrom(annotation.url),
    snippet: stringFrom(annotation.quote) ?? stringFrom(annotation.snippet) ?? stringFrom(annotation.text),
    metadata,
  });
}

function sourcesFromOpenAIUnknown(value: unknown): MessageSource[] {
  if (Array.isArray(value)) return value.flatMap(sourcesFromOpenAIUnknown);
  if (!isRecord(value)) return [];

  const nested = [value.sources, value.citations, value.annotations]
    .flatMap(sourcesFromOpenAIUnknown);
  const direct = sourceFromOpenAIResponseAnnotation(value);
  if (direct) nested.unshift(direct);
  return nested;
}

export function sourcesFromOpenAIResponseEvent(obj: Record<string, unknown>): MessageSource[] {
  return [obj.annotation, obj.annotations, recordFrom(obj.output_text)?.annotations]
    .flatMap(sourcesFromOpenAIUnknown);
}

/**
 * Anthropic Messages API citations attached to text content blocks. Each
 * citation can be a `char_location` / `page_location` / `content_block_location`
 * pointing at a tool-supplied document, or a `web_search_result_location`
 * pointing at a web search hit. We map all of them to `MessageSource` so the
 * default renderer shows them consistently with other providers; the original
 * location offsets and document index are preserved on `metadata` so callers
 * can re-anchor citations to source text if needed.
 */
export function sourceFromAnthropicCitation(citation: unknown): MessageSource | null {
  if (!isRecord(citation)) return null;
  const rawType = stringFrom(citation.type);
  const url = stringFrom(citation.url);
  const isWeb = rawType === 'web_search_result_location' || Boolean(url);
  const documentIndex = numberFrom(citation.document_index);
  const documentTitle = stringFrom(citation.document_title);
  const citedText = stringFrom(citation.cited_text);
  const metadata = withDefinedMetadata({
    provider: 'anthropic',
    citationType: rawType,
    documentIndex,
    documentTitle,
    startCharIndex: numberFrom(citation.start_char_index),
    endCharIndex: numberFrom(citation.end_char_index),
    startPageNumber: numberFrom(citation.start_page_number),
    endPageNumber: numberFrom(citation.end_page_number),
    startBlockIndex: numberFrom(citation.start_block_index),
    endBlockIndex: numberFrom(citation.end_block_index),
    encryptedIndex: stringFrom(citation.encrypted_index),
  });
  // Citations have no provider-issued id, so derive a stable one from the
  // location so repeated streamed citations dedup through appendMessageSource.
  const id = url
    ?? (documentIndex !== undefined && documentTitle ? `${documentTitle}#${documentIndex}` : undefined)
    ?? (documentIndex !== undefined ? `anthropic-document-${documentIndex}` : undefined);
  return buildSource({
    id,
    type: isWeb ? 'url' : 'document',
    title: stringFrom(citation.title) ?? documentTitle,
    url,
    snippet: citedText,
    metadata,
  });
}

/**
 * Anthropic `web_search_tool_result` content blocks carry a `content` array of
 * `web_search_result` entries (`{ url, title, encrypted_content, page_age }`).
 * Surface each as a `MessageSource` so a web-search tool turn shows its hits
 * in the same Sources footer as inline citations, without leaking the raw
 * encrypted content into the assistant text.
 */
export function sourcesFromAnthropicWebSearchToolResult(block: unknown): MessageSource[] {
  if (!isRecord(block)) return [];
  const content = block.content;
  if (!Array.isArray(content)) return [];
  const toolUseId = stringFrom(block.tool_use_id);
  const sources: MessageSource[] = [];
  for (const entry of content) {
    if (!isRecord(entry) || entry.type !== 'web_search_result') continue;
    const url = stringFrom(entry.url);
    const metadata = withDefinedMetadata({
      provider: 'anthropic',
      resultType: 'web_search_result',
      toolUseId,
      pageAge: stringFrom(entry.page_age),
      encryptedContent: stringFrom(entry.encrypted_content),
    });
    const source = buildSource({
      id: url,
      type: 'url',
      title: stringFrom(entry.title),
      url,
      metadata,
    });
    if (source) sources.push(source);
  }
  return sources;
}

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
