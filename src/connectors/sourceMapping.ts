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
